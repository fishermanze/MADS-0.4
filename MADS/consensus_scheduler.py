"""
共识驱动的渐进式多Agent调度器 v1.0

融合三篇核心论文:
  - Aegean: 稳定性窗口 + 异步法定人数 (Stability Window + Async Quorum)
  - HCP-MAD: 异构快速验证 → 可打断辩论 → 升级投票 (3阶段渐进)
  - 调度收敛: 倒U型多样性控制 + 结构化人格注入

核心机制:
  1. 稳定性窗口(β): 候选共识需连续 β 轮保持多数才确认
  2. 异步法定人数(α): 任意立场获 ≥α 支持者即触发候选共识
  3. 渐进式3阶段: fast_verify → debate → voting
  4. Swap/Stalemate检测: 辩论陷入无效时及时止损升级
  5. 多样性监测: 计算 d̄ 并维持中等分歧水平
"""

import os
import json
import random
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from dialog_router import (
    AgentCandidate,
    DialogState,
    RouterDecision,
    RouterConfig,
    ScoreBreakdown,
    heuristic_score,
    _tokenize_zh,
    _jaccard,
    _keyword_density,
    _AGREEMENT_KEYWORDS,
)

from opinion_tracker import OpinionTable, OpinionSnapshot

# ============================================================================
# 数据结构
# ============================================================================

MBTI_DISTANCE_MATRIX: Dict[str, int] = {
    "E": 1, "I": -1,   # 能量方向: 外向 vs 内向
    "S": 1, "N": -1,   # 信息: 实感 vs 直觉
    "T": 1, "F": -1,   # 决策: 思考 vs 情感
    "J": 1, "P": -1,   # 生活: 判断 vs 知觉
}


@dataclass
class ConsensusState:
    state: DialogState
    quorum_threshold: int = 0           # α: 最小支持数
    stability_window: int = 3            # β: 连续稳定轮次
    stable_rounds: int = 0               # 当前连续稳定计数
    candidate_position: str = ""         # 当前候选共识方案
    phase: str = "fast"                  # fast | debate | voting
    active_pair: List[str] = field(default_factory=list)  # 阶段1的2个Agent ID
    opinion_flip_count: int = 0          # 多数派反转次数
    position_history: List[str] = field(default_factory=list)  # 每轮多数派
    divergence_history: List[float] = field(default_factory=list)  # d̄ 历史
    phase_transitions: List[Dict[str, Any]] = field(default_factory=list)  # 阶段切换日志

    @property
    def has_quorum(self) -> bool:
        return self.quorum_threshold > 0

    @property
    def is_stable(self) -> bool:
        return self.stable_rounds >= self.stability_window


# ============================================================================
# 助手函数
# ============================================================================

def mbti_distance(a: str, b: str) -> int:
    """计算两个MBTI类型的人格距离 (0-4)"""
    if len(a) != 4 or len(b) != 4:
        return 0
    dist = 0
    for i, (ca, cb) in enumerate(zip(a, b)):
        if ca != cb:
            dist += 1
    return dist


def pick_max_mbti_pair(candidates: List[AgentCandidate]) -> Tuple[AgentCandidate, AgentCandidate]:
    """选择MBTI差异最大的两个Agent (E/I + T/F 权重加高)"""
    max_dist = -1
    best = (candidates[0], candidates[-1]) if len(candidates) >= 2 else (candidates[0], candidates[0])
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            a, b = candidates[i], candidates[j]
            d = mbti_distance(a.mbti, b.mbti)
            # EI + TF 加权
            if a.mbti[0] != b.mbti[0]: d += 1
            if a.mbti[2] != b.mbti[2]: d += 1
            if d > max_dist:
                max_dist = d
                best = (a, b)
    return best


def extract_position_short(text: str, history: Optional[List[str]] = None) -> str:
    """多维度立场提取：agree/disagree/partial/reasoning/propose + Jaccard回退"""
    text_l = text[:300].lower()

    # 5维立场关键词
    if any(w in text_l for w in ("同意", "支持", "理解", "好的", "行", "可以", "没错", "说得对", "有道理", "赞成")):
        return "agree"
    if any(w in text_l for w in ("反对", "不行", "不同意", "不对", "拒绝", "错误", "否定", "荒谬", "不合理")):
        return "disagree"
    if any(w in text_l for w in ("部分", "但是", "不过", "虽然", "然而", "保留", "一方面", "另一方面")):
        return "partial"

    # 提出新观点或论证 (propose/reasoning)
    reasoning_kw = ("因为", "所以", "如果", "那么", "证明", "推导", "公式", "假设", "设", "得出",
                    "依据", "根据", "显然", "因此", "由此", "故", "考虑", "定义", "令")
    if any(w in text_l for w in reasoning_kw):
        return "reasoning"

    # Jaccard回退：与历史最近发言相似度高则视为立场接近
    if history and len(history) >= 1:
        last = _tokenize_zh(history[-1])
        curr = _tokenize_zh(text[:300])
        if _jaccard(last, curr) >= 0.55:
            return "similar"
    return "neutral"


def is_convergent_stance(s: str) -> bool:
    """哪些立场类型可以视为趋同信号"""
    return s in ("agree", "reasoning", "similar", "propose")


def compute_divergence(utterances: List[str]) -> float:
    """计算发言间的平均语义分歧度 d̄ (0~1)"""
    if len(utterances) < 2:
        return 0.0
    sims: List[float] = []
    for i in range(len(utterances)):
        for j in range(i + 1, len(utterances)):
            sims.append(_jaccard(_tokenize_zh(utterances[i]), _tokenize_zh(utterances[j])))
    if not sims:
        return 0.0
    avg_sim = sum(sims) / len(sims)
    return round(1.0 - avg_sim, 4)


# ============================================================================
# 核心调度器
# ============================================================================

class ConsensusScheduler:
    """
    共识驱动的渐进式调度器。
    替代原有 dispatch_round()，实现:
      - 稳定性窗口 (β)
      - 异步法定人数 (α)
      - 3阶段渐进调度
      - Swap/Stalemate 检测
      - 多样性监测
    """

    def __init__(self, candidates: List[AgentCandidate], dialog_state: DialogState, config: RouterConfig):
        self.candidates = candidates
        self.dialog_state = dialog_state
        self.config = config
        self.N = len(candidates)
        self.alpha = max(2, int(self.N * 0.5))       # α = ceil(N/2)
        self.beta = getattr(config, "stability_window", 3) or 3

        self.consensus = ConsensusState(
            state=dialog_state,
            quorum_threshold=self.alpha,
            stability_window=self.beta,
        )
        self.opinion_table = OpinionTable([
            {"agent_id": c.agent_id, "role": c.role, "mbti": c.mbti}
            for c in candidates
        ] if candidates else [])
        self._opinion_endpoint = os.getenv("MADS_OPINION_LLM_ENDPOINT",
                                           "http://127.0.0.1:8002/v1")

    def schedule(self) -> RouterDecision:
        """主调度入口：根据当前阶段返回发言人选择"""
        phase = self.consensus.phase

        if phase == "fast":
            return self._phase_fast_verify()
        elif phase == "debate":
            return self._phase_debate()
        else:
            return self._phase_voting()

    def post_utterance_update(self, speaker_id: str, content: str):
        """每轮发言后更新共识状态"""
        if self.consensus.phase == "fast":
            return
        recent_texts = [h["content"] for h in self.dialog_state.history[-4:]]
        pos = extract_position_short(content, recent_texts)
        if pos != "neutral":
            self._update_position_history(pos)

        # 观点表更新 + 收敛检查
        self.opinion_table.update(speaker_id, content, self._opinion_endpoint)
        self.opinion_table.create_snapshot(
            self.dialog_state.topic[:20] if self.dialog_state.topic else "session",
            len(self.dialog_state.history))

        self._check_stability()

        # 计算多样性
        utterances = [
            h["content"] for h in self.dialog_state.history[-self.N:]
        ]
        d_bar = compute_divergence(utterances)
        self.consensus.divergence_history.append(d_bar)

    def should_terminate(self) -> Tuple[bool, str]:
        """是否应该终止对话"""
        if self.consensus.is_stable:
            return True, f"beta_stable({self.consensus.stable_rounds}/{self.beta})"

        conv = self.opinion_table.convergence_score(self.beta)
        if conv["isConverged"]:
            return True, f"opinion_converged(avgDist={conv['avgDistance']})"

        turns = len(self.consensus.position_history)
        hard_cap = max(12, self.N * 4)
        if turns >= hard_cap:
            return True, f"hard_cap({turns}/{hard_cap})"
        return False, ""

    # --- 阶段1: 异构快速验证 ---

    def _phase_fast_verify(self) -> RouterDecision:
        """快速验证：选 MBTI 差异最大的2个Agent辩论1-2轮"""
        if not self.consensus.active_pair:
            a, b = pick_max_mbti_pair(self.candidates)
            self.consensus.active_pair = [a.agent_id, b.agent_id]
            self.consensus.phase_transitions.append({
                "from": "start", "to": "fast", "turn": len(self.dialog_state.history),
                "pair": [a.agent_id, b.agent_id],
            })

        turn = len(self.dialog_state.history)
        idx = turn % len(self.consensus.active_pair)
        chosen_id = self.consensus.active_pair[idx]
        chosen = next((c for c in self.candidates if c.agent_id == chosen_id), self.candidates[0])

        if turn >= 2:
            self.consensus.phase = "debate"
            self.consensus.phase_transitions.append({
                "from": "fast", "to": "debate", "turn": turn,
                "reason": "fast_phase_complete",
            })

        heur = heuristic_score(self.candidates, self.consensus.state,
                               self.config.weights, self.config.cooldown_turns)
        return RouterDecision(
            turn=turn + 1, chosen_agent_id=chosen.agent_id, chosen_role=chosen.role,
            strategy="consensus_fast", scores=heur,
            convergence=0.0, should_stop=False, stop_reason="",
        )

    # --- 阶段2: 可打断辩论 ---

    def _phase_debate(self) -> RouterDecision:
        """辩论阶段：使用启发式评分 + swap/stalemate 检测"""
        turn = len(self.dialog_state.history)

        # 检测 swap (A↔B 交换立场)
        if self._detect_swap():
            self.consensus.phase = "voting"
            self.consensus.phase_transitions.append({
                "from": "debate", "to": "voting", "turn": turn, "reason": "swap_detected",
            })

        # 检测 stalemate (连续3轮立场不变)
        if self._detect_stalemate():
            self.consensus.phase = "voting"
            self.consensus.phase_transitions.append({
                "from": "debate", "to": "voting", "turn": turn, "reason": "stalemate_detected",
            })

        # 如果检测到多数派共识成立
        if self.consensus.candidate_position:
            self.consensus.stable_rounds += 1
        else:
            self.consensus.stable_rounds = 0

        heur = heuristic_score(self.candidates, self.consensus.state, self.config.weights, self.config.cooldown_turns)
        sorted_agents = sorted(self.candidates, key=lambda c: -heur.get(c.agent_id, ScoreBreakdown()).total)
        chosen = sorted_agents[0]
        chosen_strategy = f"consensus_debate(stable={self.consensus.stable_rounds}/{self.beta})"

        return RouterDecision(
            turn=turn + 1, chosen_agent_id=chosen.agent_id, chosen_role=chosen.role,
            strategy=chosen_strategy, scores=heur,
            convergence=0.5 if self.consensus.candidate_position else 0.0,
            should_stop=self.consensus.is_stable,
            stop_reason=f"stable={self.consensus.stable_rounds}" if self.consensus.is_stable else "",
        )

    def _detect_swap(self) -> bool:
        """检测立场交换: A↔B 互换"""
        if len(self.consensus.position_history) < 3:
            return False
        recent = self.consensus.position_history[-3:]
        return (recent[0] == "agree" and recent[1] == "disagree"
                and (recent[2] == "agree" or recent[2] == "partial"))

    def _detect_stalemate(self) -> bool:
        """检测僵局: 连续3轮立场不变"""
        if len(self.consensus.position_history) < 3:
            return False
        recent = self.consensus.position_history[-3:]
        return len(set(recent)) == 1 and recent[0] not in ("agree", "partial")

    # --- 阶段3: 升级投票 ---

    def _phase_voting(self) -> RouterDecision:
        """投票阶段：所有Agent独立判断 + 加权聚合"""
        turn = len(self.dialog_state.history)
        # 选择尚未发言的Agent，或按启发式选择一个
        spoken = {h.get("agentId", "") for h in self.consensus.state.history}
        unspoken = [c for c in self.candidates if c.agent_id not in spoken]
        if unspoken:
            chosen = unspoken[0]
        else:
            heur = heuristic_score(self.candidates, self.consensus.state, self.config.weights, self.config.cooldown_turns)
            chosen = max(self.candidates, key=lambda c: heur.get(c.agent_id, ScoreBreakdown()).total)

        # 所有Agent发言完后终止
        should_stop = len(spoken) >= self.N - 1
        return RouterDecision(
            turn=turn + 1, chosen_agent_id=chosen.agent_id, chosen_role=chosen.role,
            strategy="consensus_voting", scores={},
            convergence=0.8, should_stop=should_stop,
            stop_reason="voting_complete" if should_stop else "",
        )

    # --- 内部状态更新 ---

    def _update_position_history(self, pos: str):
        self.consensus.position_history.append(pos)
        # 有意义的立场: agree/disagree/partial/reasoning/similar (排除 neutral)
        meaningful = [p for p in self.consensus.position_history[-self.N * 3:]
                      if p != "neutral"]
        if len(meaningful) < self.alpha:
            return

        # 最近 N 条有意义的立场
        recent = meaningful[-self.N:]
        counter: Dict[str, int] = {}
        convergent_count = 0
        for p in recent:
            counter[p] = counter.get(p, 0) + 1
            if is_convergent_stance(p):
                convergent_count += 1

        # 两种收敛判定:
        # A) 单一立场 >= α (经典法定人数)
        # B) 多种趋同立场 (agree/reasoning/similar) 合计 >= α
        majority_pos = max(counter, key=counter.get)
        majority_count = counter[majority_pos]

        reached_quorum = (majority_count >= self.alpha) or (convergent_count >= self.alpha)

        if reached_quorum:
            effective_pos = majority_pos if majority_count >= self.alpha else "convergent"
            if effective_pos != self.consensus.candidate_position:
                self.consensus.candidate_position = effective_pos
                self.consensus.stable_rounds = 1
                if self.consensus.position_history.count(majority_pos) >= 2:
                    self.consensus.opinion_flip_count += 1
            else:
                self.consensus.stable_rounds += 1
        else:
            self.consensus.candidate_position = ""
            self.consensus.stable_rounds = 0

    def _check_stability(self):
        if self.consensus.stable_rounds >= self.beta:
            pass

    def get_metrics(self) -> Dict[str, Any]:
        return {
            "phase": self.consensus.phase,
            "quorum_threshold": self.consensus.quorum_threshold,
            "stability_window": self.consensus.stability_window,
            "stable_rounds": self.consensus.stable_rounds,
            "candidate_position": self.consensus.candidate_position,
            "opinion_flip_count": self.consensus.opinion_flip_count,
            "phase_transitions": self.consensus.phase_transitions,
            "divergence_history": self.consensus.divergence_history,
            "opinionConvergence": self.opinion_table.convergence_score(self.beta),
            "agentOpinions": {aid: a.opinion for aid, a in self.opinion_table.agents.items()},
        }


# ============================================================================
# 替代 dispatch_round() 的顶层入口
# ============================================================================

def dispatch_consensus_round(
    candidates: List[AgentCandidate],
    dialog_state: DialogState,
    config: RouterConfig,
    scheduler: Optional[ConsensusScheduler] = None,
) -> Tuple[RouterDecision, ConsensusScheduler]:
    """共识调度器顶层入口。首次调用创建 scheduler，后续复用。"""
    if scheduler is None:
        scheduler = ConsensusScheduler(candidates, dialog_state, config)
    decision = scheduler.schedule()
    return decision, scheduler
