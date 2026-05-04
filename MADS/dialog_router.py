from __future__ import annotations

import json
import os
import random
import re
import time
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional, Sequence, Tuple
from urllib import request as urllib_request

# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class AgentCandidate:
    """调度器视角的候选角色快照(从 ModelConfig 提炼, 解耦上层 Pydantic)。"""
    agent_id: str
    role: str
    model_name: str
    persona_id: Optional[str]
    persona_prompt: Optional[str]
    mbti: str
    spoken_turns: List[int] = field(default_factory=list)
    last_utterance: str = ""

    @property
    def mediation_bias(self) -> int:
        """F/J/E 在调解场景中更适合先打开局面。"""
        mbti = self.mbti.upper()
        return (2 if len(mbti) > 2 and mbti[2] == "F" else 0) + (1 if len(mbti) > 3 and mbti[3] == "J" else 0) + (1 if mbti.startswith("E") else 0)

    @property
    def extroverted(self) -> bool:
        return self.mbti.upper().startswith("E")

    @property
    def intuitive(self) -> bool:
        return len(self.mbti) > 1 and self.mbti.upper()[1] == "N"

    @property
    def feeling(self) -> bool:
        return len(self.mbti) > 2 and self.mbti.upper()[2] == "F"

    @property
    def judging(self) -> bool:
        return len(self.mbti) > 3 and self.mbti.upper()[3] == "J"


@dataclass
class ScoreBreakdown:
    goal: float = 0.0
    emotion_fit: float = 0.0
    cooldown: float = 0.0
    diversity: float = 0.0
    mbti_align: float = 0.0
    total: float = 0.0
    predicted_emotion: str = "neutral"
    reason: str = ""


@dataclass
class RouterDecision:
    turn: int
    chosen_agent_id: str
    chosen_role: str
    strategy: str          # heuristic | llm | hybrid | random_tiebreak
    scores: Dict[str, ScoreBreakdown]
    convergence: float
    should_stop: bool
    stop_reason: str = ""

    def to_event_dict(self) -> Dict[str, Any]:
        return {
            "turn": self.turn,
            "chosenAgentId": self.chosen_agent_id,
            "chosenRole": self.chosen_role,
            "strategy": self.strategy,
            "scores": [
                {
                    "agentId": k,
                    "goal": round(v.goal, 4),
                    "emotionFit": round(v.emotion_fit, 4),
                    "cooldown": round(v.cooldown, 4),
                    "diversity": round(v.diversity, 4),
                    "mbtiAlign": round(v.mbti_align, 4),
                    "total": round(v.total, 4),
                    "predictedEmotion": v.predicted_emotion,
                    "reason": v.reason,
                }
                for k, v in self.scores.items()
            ],
            "convergence": round(self.convergence, 4),
            "shouldStop": self.should_stop,
            "stopReason": self.stop_reason,
        }


@dataclass
class DialogState:
    """对话进行中状态(轮次累计的语料 + 已说过的人)。"""
    topic: str
    scenario: str
    user_message: str
    history: List[Dict[str, str]] = field(default_factory=list)  # {speaker, content, turn}
    last_speaker_id: Optional[str] = None
    consecutive_low_novelty: int = 0
    consecutive_high_agreement: int = 0
    expected_agent_count: int = 0
    consecutive_stagnation: int = 0
    best_total_novelty: float = 0.0

    def append_utterance(self, agent_id: str, role: str, content: str, turn: int) -> None:
        self.history.append({"agentId": agent_id, "speaker": role, "content": content, "turn": turn})
        self.last_speaker_id = agent_id


# ---------------------------------------------------------------------------
# 配置与工具
# ---------------------------------------------------------------------------

_AGREEMENT_KEYWORDS = (
    "同意", "认同", "明白", "好的", "可以", "理解", "赞同", "支持", "没问题",
    "OK", "ok", "行", "对", "嗯", "好吧", "确实", "有道理", "我接受", "听你的",
)
_NEGATIVE_KEYWORDS = (
    "不行", "拒绝", "反对", "讨厌", "烦", "气", "错", "笨", "废物", "懒",
    "没用", "失望", "崩溃", "受不了", "凭什么", "闭嘴",
)
_GOAL_PROGRESS_KEYWORDS = (
    "建议", "我们可以", "不如", "试试", "下一步", "决定", "约定", "规则",
    "答应", "保证", "改进", "妥协", "中间", "折中", "先听", "说清楚",
)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "").strip() or default)
    except Exception:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except Exception:
        return default


def _scenario_intent(scenario: str) -> str:
    """场景目的关键词(用于评分提示)。"""
    s = (scenario or "").upper()
    if s == "SCHOOL":
        return "促进学生间相互理解, 推动协作完成讨论, 避免边缘化与压制"
    return "缓和家庭冲突, 修复亲子/夫妻沟通, 推动达成具体共识"


def _tokenize_zh(text: str) -> List[str]:
    """轻量中英分词: 中文按字 + 英文按词。够算 Jaccard。"""
    if not text:
        return []
    text = text.lower()
    en_words = re.findall(r"[a-z0-9]+", text)
    zh_chars = [ch for ch in text if "\u4e00" <= ch <= "\u9fff"]
    return en_words + zh_chars


def _jaccard(a: Sequence[str], b: Sequence[str]) -> float:
    if not a or not b:
        return 0.0
    sa, sb = set(a), set(b)
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def _keyword_density(text: str, vocab: Sequence[str]) -> float:
    if not text:
        return 0.0
    hits = sum(1 for kw in vocab if kw in text)
    length = max(1, len(text) / 10)  # 每 10 字归一
    return min(1.0, hits / length)


# ---------------------------------------------------------------------------
# 启发式评分
# ---------------------------------------------------------------------------

def _score_goal(cand: AgentCandidate, state: DialogState) -> Tuple[float, str]:
    """
    GoalScore: 越能推动达成目标越高。
    依据: MBTI 的 F/J/N 倾向 + 角色历史话语的"建设性词密度"。
    """
    base = 0.35
    if cand.feeling:
        base += 0.25
    if cand.judging:
        base += 0.20
    if cand.intuitive:
        base += 0.10
    if cand.extroverted:
        base += 0.05
    last_text = " ".join(h["content"] for h in state.history if h["agentId"] == cand.agent_id)
    constructive = _keyword_density(last_text, _GOAL_PROGRESS_KEYWORDS) if last_text else 0.4
    score = 0.6 * base + 0.4 * constructive
    reason = f"MBTI={cand.mbti} 建设性={constructive:.2f}"
    return min(1.0, score), reason


def _score_emotion_fit(cand: AgentCandidate, state: DialogState) -> Tuple[float, str]:
    """
    EmotionFit: 预测此角色下一轮的情感是否适配当前场景目的。
    F/J 更适合调解; 上轮消极时 T/P 倾向会略降分。
    """
    base_fit = 0.45
    if cand.feeling:
        base_fit += 0.25
    if cand.judging:
        base_fit += 0.15
    if cand.extroverted:
        base_fit += 0.05

    last = state.history[-1]["content"] if state.history else ""
    last_negative = _keyword_density(last, _NEGATIVE_KEYWORDS)
    if last_negative > 0.2 and not cand.feeling:
        base_fit *= 0.75
        emotion = "tense"
    elif cand.feeling:
        emotion = "supportive"
    else:
        emotion = "neutral"
    reason = f"MBTI={cand.mbti} 上轮负面={last_negative:.2f}"
    return min(1.0, max(0.0, base_fit)), reason, emotion  # type: ignore[return-value]


def _score_cooldown(cand: AgentCandidate, state: DialogState, cooldown_turns: int) -> Tuple[float, str]:
    """
    CooldownScore: 越久没说话分越高。
    """
    if not state.history:
        return 1.0, "未发言"
    last_idx = -1
    for i in range(len(state.history) - 1, -1, -1):
        if state.history[i]["agentId"] == cand.agent_id:
            last_idx = i
            break
    if last_idx == -1:
        return 1.0, "首次发言"
    gap = (len(state.history) - 1) - last_idx
    if gap < cooldown_turns:
        return 0.1, f"刚说过(gap={gap})"
    return min(1.0, 0.4 + 0.15 * gap), f"间隔={gap}"


def _score_diversity(cand: AgentCandidate, state: DialogState, total_agents: int) -> Tuple[float, str]:
    """
    DiversityScore: 发言次数低于平均值 -> 加分。
    """
    counts = sum(1 for h in state.history if h["agentId"] == cand.agent_id)
    if not state.history:
        return 1.0, "起始"
    avg = len(state.history) / max(1, total_agents)
    if counts < avg:
        return min(1.0, 0.6 + (avg - counts) * 0.2), f"发言{counts}/平均{avg:.1f}"
    return max(0.2, 1.0 - (counts - avg) * 0.2), f"发言{counts}/平均{avg:.1f}"


def _score_mbti_align(cand: AgentCandidate, scenario: str) -> Tuple[float, str]:
    """
    MBTI 与场景目的的契合度。调解场景倾向 F/J, 学校讨论略偏 E/N。
    """
    score = 0.35
    if cand.feeling:
        score += 0.25
    if cand.judging:
        score += 0.20
    if scenario.upper() == "SCHOOL" and (cand.extroverted or cand.intuitive):
        score += 0.10
    if scenario.upper() != "SCHOOL" and cand.feeling:
        score += 0.10
    return min(1.0, score), f"MBTI={cand.mbti}"


def heuristic_score(
    candidates: List[AgentCandidate],
    state: DialogState,
    weights: Dict[str, float],
    cooldown_turns: int,
) -> Dict[str, ScoreBreakdown]:
    """对每个候选打分, 返回 {agent_id: ScoreBreakdown}。"""
    n = len(candidates)
    out: Dict[str, ScoreBreakdown] = {}
    addressed = _detect_addressed_agents(candidates, state)
    speak_counts = {
        cand.agent_id: sum(1 for h in state.history if h["agentId"] == cand.agent_id)
        for cand in candidates
    }
    max_count = max(speak_counts.values(), default=0)
    for cand in candidates:
        g, g_reason = _score_goal(cand, state)
        e, e_reason, emo = _score_emotion_fit(cand, state)
        c, c_reason = _score_cooldown(cand, state, cooldown_turns)
        d, d_reason = _score_diversity(cand, state, n)
        am, am_reason = _score_mbti_align(cand, state.scenario)

        total = (
            weights.get("goal", 0.30) * g
            + weights.get("emotion_fit", 0.25) * e
            + weights.get("cooldown", 0.20) * c
            + weights.get("diversity", 0.10) * d
            + weights.get("mbti_align", 0.15) * am
        )
        addressed_reason = addressed.get(cand.agent_id)
        if addressed_reason:
            total = max(total + 0.65, 1.15)
        fairness_reason = ""
        if state.history and speak_counts.get(cand.agent_id, 0) == 0:
            total += 0.55
            fairness_reason = "unspoken"
        elif max_count - speak_counts.get(cand.agent_id, 0) >= 2:
            total += 0.30
            fairness_reason = "under_spoken"
        out[cand.agent_id] = ScoreBreakdown(
            goal=g, emotion_fit=e, cooldown=c, diversity=d, mbti_align=am,
            total=total, predicted_emotion=emo,
            reason=f"goal[{g_reason}] emo[{e_reason}] cool[{c_reason}] div[{d_reason}] mbti[{am_reason}]"
                   + (f" addressed[{addressed_reason}]" if addressed_reason else "")
                   + (f" fairness[{fairness_reason}]" if fairness_reason else ""),
        )
    return out


def _detect_addressed_agents(candidates: List[AgentCandidate], state: DialogState) -> Dict[str, str]:
    """
    识别上一句是否在点名某个角色回答，例如“母亲怎么看？”或“第二个角色怎么看？”。
    命中后给对应候选强加分，避免路由跳到无关角色。
    """
    if not candidates:
        return {}
    text = ""
    if state.history:
        text = state.history[-1].get("content", "")
    if not text:
        text = state.user_message or ""
    compact = re.sub(r"\s+", "", text)
    if not compact:
        return {}

    response_cues = ("怎么看", "怎么想", "你觉得", "你认为", "说说", "回答", "回应", "解释", "呢", "吗", "?","？")
    if not any(cue in compact for cue in response_cues):
        return {}

    out: Dict[str, str] = {}
    for cand in candidates:
        role = re.sub(r"\s+", "", cand.role or "")
        if role and role in compact:
            out[cand.agent_id] = f"role_mentioned:{cand.role}"

    ordinal_map = {
        "第一个角色": 0, "第一位角色": 0, "1号角色": 0, "一号角色": 0,
        "第二个角色": 1, "第二位角色": 1, "2号角色": 1, "二号角色": 1,
        "第三个角色": 2, "第三位角色": 2, "3号角色": 2, "三号角色": 2,
        "第四个角色": 3, "第四位角色": 3, "4号角色": 3, "四号角色": 3,
    }
    for phrase, index in ordinal_map.items():
        if phrase in compact and 0 <= index < len(candidates):
            out[candidates[index].agent_id] = f"ordinal_mentioned:{phrase}"
    return out


# ---------------------------------------------------------------------------
# LLM 评分(可选)
# ---------------------------------------------------------------------------

def _router_llm_endpoint() -> Optional[Dict[str, str]]:
    base = os.getenv("MADS_ROUTER_LLM_BASE", "").strip()
    model = os.getenv("MADS_ROUTER_LLM_MODEL", "").strip()
    key = os.getenv("MADS_ROUTER_LLM_KEY", "EMPTY").strip() or "EMPTY"
    source = "router_env"
    if not base or not model:
        fallback = _dialog_llm_endpoint()
        if fallback:
            return fallback
        return None
    base = _normalize_openai_base(base)
    return {"base_url": base, "model": model, "api_key": key, "source": source}


def _dialog_llm_endpoint() -> Optional[Dict[str, str]]:
    """
    默认复用角色对话的 OpenAI/SGLang 接口做 hybrid 路由评分。
    如果显式配置 MADS_ROUTER_LLM_BASE/MODEL，则不会走这里。
    """
    if os.getenv("MADS_ROUTER_USE_DIALOG_MODEL", "true").lower() == "false":
        return None

    model_key = os.getenv("MADS_ROUTER_DIALOG_MODEL_KEY", "llama3").strip() or "llama3"
    route_table = _parse_dialog_model_routes()
    route = route_table.get(model_key) or {}
    base = str(route.get("base_url") or "").strip()
    model = _base_model_name(str(route.get("base_model") or route.get("model") or "").strip(), model_key)
    key = str(route.get("api_key") or "").strip()

    if not base or not model:
        if model_key.lower() == "qwen":
            base = os.getenv("MADS_QWEN_OPENAI_BASE", "").strip()
            model = _base_model_name(
                os.getenv("MADS_ROUTER_DIALOG_BASE_MODEL", "")
                or os.getenv("MADS_QWEN_BASE_MODEL", "")
                or os.getenv("MADS_QWEN_OPENAI_MODEL", "qwen"),
                "qwen",
            )
            key = os.getenv("MADS_QWEN_OPENAI_KEY", os.getenv("MADS_REMOTE_OPENAI_KEY", "EMPTY")).strip() or "EMPTY"
        else:
            base = os.getenv("MADS_REMOTE_OPENAI_BASE", "").strip()
            model = _base_model_name(
                os.getenv("MADS_ROUTER_DIALOG_BASE_MODEL", "")
                or os.getenv("MADS_REMOTE_BASE_MODEL", "")
                or os.getenv("MADS_REMOTE_OPENAI_MODEL", "llama3"),
                "llama3",
            )
            key = os.getenv("MADS_REMOTE_OPENAI_KEY", "EMPTY").strip() or "EMPTY"

    if not base or not model:
        return None
    return {
        "base_url": _normalize_openai_base(base),
        "model": model,
        "api_key": key or "EMPTY",
        "source": f"dialog_model:{model_key}",
    }


def _base_model_name(value: str, fallback: str) -> str:
    cleaned = (value or fallback).strip() or fallback
    # 路由评分必须使用基座模型，避免人格 LoRA 影响评分倾向。
    if ":" in cleaned:
        cleaned = cleaned.split(":", 1)[0].strip()
    return cleaned or fallback


def _parse_dialog_model_routes() -> Dict[str, Dict[str, str]]:
    raw = os.getenv("MADS_MODEL_ROUTES", "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}
    out: Dict[str, Dict[str, str]] = {}
    for key, value in parsed.items():
        if not isinstance(value, dict):
            continue
        out[str(key)] = {
            "base_url": _normalize_openai_base(str(value.get("base_url") or "").strip()),
            "model": str(value.get("model") or "").strip(),
            "base_model": str(value.get("base_model") or value.get("baseModel") or "").strip(),
            "api_key": str(value.get("api_key") or os.getenv("MADS_REMOTE_OPENAI_KEY", "EMPTY")).strip() or "EMPTY",
        }
    return out


def _normalize_openai_base(base: str) -> str:
    cleaned = base.strip().rstrip("/")
    if not cleaned:
        return ""
    if cleaned.endswith("/v1"):
        return cleaned
    return f"{cleaned}/v1"


def _llm_score_via_chat(
    candidates: List[AgentCandidate],
    state: DialogState,
    timeout: float,
) -> Optional[Dict[str, ScoreBreakdown]]:
    """
    调外置 router LLM(OpenAI Chat 兼容)。失败返回 None。
    Prompt 强约束 JSON 输出, 解析失败也返回 None。
    """
    cfg = _router_llm_endpoint()
    if not cfg:
        return None
    print(
        f"[dialog-router] llm_score endpoint_source={cfg.get('source', 'unknown')} "
        f"base_url={cfg.get('base_url', '')} model={cfg.get('model', '')}",
        flush=True,
    )
    cand_brief = [
        {
            "agentId": c.agent_id,
            "role": c.role,
            "mbti": c.mbti,
            "personaPrompt": (c.persona_prompt or "")[:120],
            "spokenCount": sum(1 for h in state.history if h["agentId"] == c.agent_id),
        }
        for c in candidates
    ]
    history_brief = [
        {"speaker": h["speaker"], "content": h["content"][:200]}
        for h in state.history[-6:]
    ]
    sys = (
        "你是多智能体对话调度器。基于场景目的, 为每个候选角色预测下一轮发言的:"
        " (a) 情感倾向 (positive/neutral/tense/escalating/supportive),"
        " (b) 目标推动力 0~1, (c) 综合选择得分 0~1。返回严格 JSON, 不要解释。"
    )
    user = json.dumps(
        {
            "scenario": state.scenario,
            "scenarioIntent": _scenario_intent(state.scenario),
            "topic": state.topic,
            "userMessage": state.user_message,
            "history": history_brief,
            "candidates": cand_brief,
            "outputSchema": {
                "candidates": [
                    {"agentId": "str", "predictedEmotion": "str",
                     "goalImpact": "0..1", "score": "0..1", "reason": "str"}
                ]
            },
        },
        ensure_ascii=False,
    )
    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": sys},
            {"role": "user", "content": user},
        ],
        "temperature": 0.2,
        "stream": False,
    }
    try:
        body = json.dumps(payload).encode("utf-8")
        req = urllib_request.Request(
            cfg["base_url"] + "/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {cfg['api_key']}",
            },
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=timeout) as resp:
            if resp.status < 200 or resp.status >= 300:
                return None
            text = resp.read().decode("utf-8")
        parsed = json.loads(text)
        content = parsed["choices"][0]["message"]["content"]
        # 容错: 抠出第一段 JSON
        match = re.search(r"\{[\s\S]+\}", content)
        if not match:
            return None
        decision = json.loads(match.group(0))
        items = decision.get("candidates") or []
        if not isinstance(items, list):
            return None
        out: Dict[str, ScoreBreakdown] = {}
        for it in items:
            if not isinstance(it, dict):
                continue
            aid = str(it.get("agentId", "")).strip()
            if not aid:
                continue
            score = float(it.get("score", 0.5))
            goal_impact = float(it.get("goalImpact", 0.5))
            out[aid] = ScoreBreakdown(
                goal=goal_impact, emotion_fit=score, cooldown=0.0, diversity=0.0,
                mbti_align=0.0, total=score, predicted_emotion=str(it.get("predictedEmotion", "neutral")),
                reason=f"LLM: {str(it.get('reason', ''))[:100]}",
            )
        return out or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# 调度主入口
# ---------------------------------------------------------------------------

def _merge_scores(heur: Dict[str, ScoreBreakdown], llm: Dict[str, ScoreBreakdown]) -> Dict[str, ScoreBreakdown]:
    """hybrid: heuristic 60% + llm 40% 加权融合。"""
    out: Dict[str, ScoreBreakdown] = {}
    for aid, h in heur.items():
        l = llm.get(aid)
        if not l:
            out[aid] = h
            continue
        merged = ScoreBreakdown(
            goal=h.goal,
            emotion_fit=h.emotion_fit,
            cooldown=h.cooldown,
            diversity=h.diversity,
            mbti_align=h.mbti_align,
            total=0.6 * h.total + 0.4 * l.total,
            predicted_emotion=l.predicted_emotion or h.predicted_emotion,
            reason=f"hybrid({h.reason} || {l.reason})",
        )
        out[aid] = merged
    return out


def choose_speaker(
    candidates: List[AgentCandidate],
    scores: Dict[str, ScoreBreakdown],
    rng: random.Random,
) -> Tuple[AgentCandidate, str]:
    """
    在打分基础上挑一个发言者。
    tie-break: 同分先比 T+R, 再随机。
    返回 (chosen, strategy_used)。
    """
    if not candidates:
        raise ValueError("no candidates")
    ranked = sorted(
        candidates,
        key=lambda c: (
            -scores.get(c.agent_id, ScoreBreakdown()).total,
            -c.mediation_bias,
        ),
    )
    top_total = scores.get(ranked[0].agent_id, ScoreBreakdown()).total
    top_bias = ranked[0].mediation_bias
    # 收集"完全同分"的候选
    tied = [c for c in ranked if abs(scores.get(c.agent_id, ScoreBreakdown()).total - top_total) < 1e-6
            and c.mediation_bias == top_bias]
    if len(tied) > 1:
        return rng.choice(tied), "random_tiebreak"
    return ranked[0], "score_top"


# ---------------------------------------------------------------------------
# 收敛检测
# ---------------------------------------------------------------------------

@dataclass
class ConvergenceResult:
    score: float
    should_stop: bool
    reason: str


def evaluate_convergence(
    state: DialogState,
    last_reply: str,
    turn: int,
    max_rounds: int,
    threshold: float,
    consecutive_required: int,
) -> ConvergenceResult:
    """
    收敛 = 同意/重复/进度/最近相似度 综合分；
    同时附加“僵局检测”：如果整体新颖度长时间不增长，强制停止，避免审问式循环。
    """
    progress = min(1.0, turn / max(1, max_rounds))

    agree = _keyword_density(last_reply, _AGREEMENT_KEYWORDS)
    last_tokens = _tokenize_zh(last_reply)
    prior_text = " ".join(h["content"] for h in state.history[:-1])
    prior_tokens = _tokenize_zh(prior_text)
    novelty = 1.0 - _jaccard(last_tokens, prior_tokens) if prior_tokens else 1.0

    recent_similarity = 0.0
    if len(state.history) >= 2:
        prev_tokens = _tokenize_zh(state.history[-2]["content"])
        recent_similarity = _jaccard(last_tokens, prev_tokens)

    same_speaker_similarity = 0.0
    if state.history:
        last_agent = state.history[-1].get("agentId")
        prior_same_speaker = [
            h["content"] for h in state.history[:-1] if h.get("agentId") == last_agent
        ][-3:]
        if prior_same_speaker:
            tokens_other = _tokenize_zh(" ".join(prior_same_speaker))
            same_speaker_similarity = _jaccard(last_tokens, tokens_other)

    score = 0.40 * agree + 0.30 * (1 - novelty) + 0.20 * progress + 0.10 * recent_similarity

    if score >= threshold:
        state.consecutive_high_agreement += 1
    else:
        state.consecutive_high_agreement = 0
    if novelty < 0.20 or recent_similarity > 0.55 or same_speaker_similarity > 0.55:
        state.consecutive_low_novelty += 1
    else:
        state.consecutive_low_novelty = 0

    if novelty > state.best_total_novelty + 0.03:
        state.best_total_novelty = novelty
        state.consecutive_stagnation = 0
    else:
        state.consecutive_stagnation += 1

    should_stop = False
    reason = ""
    expected = getattr(state, "expected_agent_count", 0) or 0
    speak_counts = _speaker_counts(state)
    min_per_agent = min(speak_counts.values()) if speak_counts and expected else 0
    everyone_spoke_twice = expected > 0 and min_per_agent >= 2
    hard_stop_turns = max(12, expected * 6)

    if everyone_spoke_twice and recent_similarity > 0.7:
        should_stop = True
        reason = f"near_duplicate_reply(recent={recent_similarity:.2f})"
    elif everyone_spoke_twice and same_speaker_similarity > 0.6:
        should_stop = True
        reason = f"same_speaker_repeat(sim={same_speaker_similarity:.2f})"
    elif everyone_spoke_twice and state.consecutive_high_agreement >= consecutive_required:
        should_stop = True
        reason = f"agreement_consecutive>={consecutive_required}(score={score:.2f})"
    elif everyone_spoke_twice and state.consecutive_low_novelty >= max(3, consecutive_required + 1):
        should_stop = True
        reason = f"low_novelty_consecutive>={consecutive_required}(novelty={novelty:.2f}, recent={recent_similarity:.2f})"
    elif everyone_spoke_twice and state.consecutive_stagnation >= max(4, consecutive_required + 2):
        should_stop = True
        reason = f"no_progress_stagnation({state.consecutive_stagnation}rounds)"
    elif turn >= hard_stop_turns:
        should_stop = True
        reason = f"hard_stop_reached({turn}/{hard_stop_turns})"
    elif turn >= max_rounds:
        should_stop = True
        reason = f"max_rounds_reached({turn}/{max_rounds})"
    return ConvergenceResult(score=score, should_stop=should_stop, reason=reason)


def _speaker_counts(state: DialogState) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    for h in state.history:
        aid = h.get("agentId")
        if not aid:
            continue
        counts[aid] = counts.get(aid, 0) + 1
    return counts


def _all_candidates_spoken(state: DialogState) -> bool:
    expected = getattr(state, "expected_agent_count", 0)
    if not expected:
        return True
    spoken = {h.get("agentId") for h in state.history if h.get("agentId")}
    return len(spoken) >= expected


# ---------------------------------------------------------------------------
# 顶层 API: dispatch_round
# ---------------------------------------------------------------------------

@dataclass
class RouterConfig:
    strategy: str = "hybrid"             # heuristic | llm | hybrid | none
    cooldown_turns: int = 1
    convergence_threshold: float = 0.65
    consecutive_required: int = 2
    seed: Optional[int] = None
    weights: Dict[str, float] = field(default_factory=lambda: {
        "goal": 0.30, "emotion_fit": 0.25, "cooldown": 0.20,
        "diversity": 0.10, "mbti_align": 0.15,
    })
    llm_timeout_seconds: float = 4.0

    @classmethod
    def from_env_and_request(cls, req_strategy: str, req_threshold: Optional[float]) -> "RouterConfig":
        cfg = cls()
        if req_strategy and req_strategy != "none":
            cfg.strategy = req_strategy
        else:
            cfg.strategy = os.getenv("MADS_ROUTER_STRATEGY", "hybrid").strip() or "hybrid"
        cfg.cooldown_turns = _env_int("MADS_ROUTER_COOLDOWN_TURNS", 1)
        if req_threshold is not None:
            cfg.convergence_threshold = float(req_threshold)
        else:
            cfg.convergence_threshold = _env_float("MADS_ROUTER_CONVERGENCE_THRESHOLD", 0.55)
        cfg.consecutive_required = _env_int("MADS_ROUTER_CONVERGENCE_CONSECUTIVE", 2)
        cfg.llm_timeout_seconds = _env_float("MADS_ROUTER_LLM_TIMEOUT_SECONDS", 4.0)
        seed_env = os.getenv("MADS_ROUTER_SEED", "").strip()
        cfg.seed = int(seed_env) if seed_env.isdigit() else None
        return cfg


def dispatch_round(
    candidates: List[AgentCandidate],
    state: DialogState,
    turn: int,
    config: RouterConfig,
) -> RouterDecision:
    """单轮调度: 给定候选 + 状态 -> 选定发言者 + 收敛预判。"""
    rng = random.Random(config.seed if config.seed is not None else time.time_ns())

    heur = heuristic_score(candidates, state, config.weights, config.cooldown_turns)

    scores = heur
    used_strategy = "heuristic"
    if config.strategy in ("llm", "hybrid"):
        llm = _llm_score_via_chat(candidates, state, timeout=config.llm_timeout_seconds)
        if llm:
            if config.strategy == "llm":
                # llm 模式仍保留 heur 作为基线, 只覆盖 total
                merged: Dict[str, ScoreBreakdown] = {}
                for aid, h in heur.items():
                    l = llm.get(aid)
                    if l:
                        h.total = l.total
                        h.predicted_emotion = l.predicted_emotion
                        h.reason = f"llm: {l.reason}"
                    merged[aid] = h
                scores = merged
                used_strategy = "llm"
            else:
                scores = _merge_scores(heur, llm)
                used_strategy = "hybrid"
        else:
            used_strategy = "hybrid_fallback_heuristic" if config.strategy == "hybrid" else "llm_fallback_heuristic"

    chosen, tie_strategy = choose_speaker(candidates, scores, rng)
    final_strategy = used_strategy if tie_strategy == "score_top" else f"{used_strategy}+{tie_strategy}"

    # 收敛先做"前瞻"占位, 真实 convergence 应在 utterance 后再算
    return RouterDecision(
        turn=turn,
        chosen_agent_id=chosen.agent_id,
        chosen_role=chosen.role,
        strategy=final_strategy,
        scores=scores,
        convergence=0.0,
        should_stop=False,
        stop_reason="",
    )


# ---------------------------------------------------------------------------
# 论文方法 1: 知识分片 + 冲突合并(可选, 预留接口)
# ---------------------------------------------------------------------------

class KnowledgeShardModerator:
    """
    主持人接收任务 + 完整知识库, 切片广播给每个子智能体。
    各智能体只能用自己的分片回答; 答案不一致时再次合并发回相关子智能体重判。

    ⚠️ 当前为最小可用骨架: 切片用按字符等分; 一致性比较用 token Jaccard。
        需要更精细的 chunking/语义比较时可替换 _split_corpus 与 _are_consistent。
    """

    def __init__(self, agents: List[AgentCandidate], min_jaccard_for_consistency: float = 0.55):
        self.agents = agents
        self.min_jaccard = min_jaccard_for_consistency

    def _split_corpus(self, corpus: str) -> List[str]:
        n = max(1, len(self.agents))
        size = max(1, len(corpus) // n)
        shards = [corpus[i * size:(i + 1) * size] for i in range(n)]
        # 把余数粘到最后一片, 保持完整
        if len(corpus) > n * size:
            shards[-1] += corpus[n * size:]
        return shards

    def assign_shards(self, corpus: str) -> Dict[str, str]:
        shards = self._split_corpus(corpus)
        return {a.agent_id: shards[i] for i, a in enumerate(self.agents)}

    @staticmethod
    def is_no_answer(reply: str) -> bool:
        if not reply:
            return True
        normalized = reply.strip().lower()
        return any(tag in normalized for tag in (
            "没有找到", "未找到", "no answer", "not found", "无相关信息"
        ))

    def find_conflicts(self, replies: Dict[str, str]) -> List[List[str]]:
        """返回需要复议的 agent_id 分组, 每组答案"互不一致"。"""
        valid = [(aid, r) for aid, r in replies.items() if not self.is_no_answer(r)]
        if len(valid) < 2:
            return []
        groups: List[List[Tuple[str, str]]] = []
        for aid, r in valid:
            placed = False
            tokens_r = _tokenize_zh(r)
            for grp in groups:
                rep_tokens = _tokenize_zh(grp[0][1])
                if _jaccard(tokens_r, rep_tokens) >= self.min_jaccard:
                    grp.append((aid, r))
                    placed = True
                    break
            if not placed:
                groups.append([(aid, r)])
        if len(groups) <= 1:
            return []
        return [[aid for aid, _ in g] for g in groups]

    def merge_for_resolution(self, replies: Dict[str, str], conflict_group_ids: List[str]) -> str:
        """生成复议提示: 把冲突方的答案拼起来发回它们重新统一。"""
        bullets = "\n".join(
            f"- {aid}: {replies.get(aid, '')[:300]}" for aid in conflict_group_ids
        )
        return (
            "以下是你们(基于不同知识分片)给出的不一致答案, 请共同协商后给出一个统一答案:\n"
            f"{bullets}\n请直接给出共识答案, 若无法达成共识请说明分歧点。"
        )
