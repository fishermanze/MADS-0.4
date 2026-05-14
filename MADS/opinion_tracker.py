"""
人格驱动的渐进式观点收敛系统 v1.0

每个 Agent 维护一个观点快照，每轮发言后由本地 SGLang base model 提取核心观点摘要。
通过 pairwise 观点距离 + 稳定轮次判定自然收敛。

零成本实现：复用现有 SGLang 部署（qwen3 base model, 不加 LoRA）。
"""

import json
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from dialog_router import _tokenize_zh, _jaccard


@dataclass
class AgentOpinion:
    agent_id: str
    role: str
    mbti: str
    opinion: str = ""                    # LLM 提取的当前观点摘要
    conviction: float = 0.5              # 信念强度 0~1
    stability_rounds: int = 0            # 连续不变的轮次
    history: List[str] = field(default_factory=list)  # 历史观点快照


@dataclass
class OpinionSnapshot:
    """一轮完整的观点快照，可序列化存入 MongoDB"""
    session_id: str
    turn: int
    agent_opinions: Dict[str, str] = field(default_factory=dict)
    pairwise_distances: Dict[str, float] = field(default_factory=dict)
    avg_distance: float = 0.0
    all_stable: bool = False
    timestamp: str = ""


class OpinionTable:
    """维护所有 Agent 的观点状态，计算收敛指标"""

    def __init__(self, agents: List[Dict[str, str]]):
        self.agents: Dict[str, AgentOpinion] = {}
        for a in agents:
            self.agents[a["agent_id"]] = AgentOpinion(
                agent_id=a["agent_id"],
                role=a.get("role", ""),
                mbti=a.get("mbti", "ISFJ"),
            )
        self.snapshots: List[OpinionSnapshot] = []

    def extract_opinion(self, agent_id: str, utterance: str,
                        context: str = "", endpoint: str = "") -> str:
        """调用 SGLang base model 提取核心观点摘要（30字以内）"""
        if not utterance.strip():
            return self.agents[agent_id].opinion

        prompt = (
            f"从以下发言中提取该发言者的核心立场或观点，不超过30字，只输出观点本身：\n\n"
            f"发言者角色：{self.agents[agent_id].role}\n"
            f"发言内容：{utterance[:300]}\n\n"
            f"核心观点："
        )

        try:
            import urllib.request as urllib_req
            body = json.dumps({
                "model": "qwen3",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 2048,
                "temperature": 0.1,
                "enable_thinking": False,
            }).encode("utf-8")
            url = (endpoint or os.getenv("MADS_OPINION_LLM_ENDPOINT",
                    "http://127.0.0.1:8002/v1")).rstrip("/") + "/chat/completions"
            req = urllib_req.Request(url, data=body,
                                     headers={"Content-Type": "application/json"})
            with urllib_req.urlopen(req, timeout=15) as resp:
                data = json.load(resp)
                raw = data["choices"][0]["message"]["content"]
                cleaned = re.sub(r"</?\\?think>[\s\S]*?{://}", "", raw, flags=re.IGNORECASE)
                cleaned = re.sub(r"<think>[\s\S]*?</think>", "", cleaned, flags=re.IGNORECASE)
                cleaned = re.sub(r"</?\\?think>", "", cleaned, flags=re.IGNORECASE)
                return cleaned.replace("{://}", "").strip()[:40]
        except Exception:
            pass
        return _fallback_extract(utterance)

    def update(self, agent_id: str, utterance: str,
               endpoint: str = "") -> Tuple[bool, str]:
        """更新单个 Agent 的观点，返回 (是否变化, 新观点)"""
        agent = self.agents[agent_id]
        context = " | ".join(
            f"{self.agents[aid].role}: {self.agents[aid].opinion[:20]}"
            for aid in self.agents if aid != agent_id
        ) if len(self.agents) > 1 else ""

        new_opinion = self.extract_opinion(agent_id, utterance, context, endpoint)
        if not new_opinion:
            return False, agent.opinion

        old = agent.opinion
        if old and _jaccard(_tokenize_zh(new_opinion), _tokenize_zh(old)) > 0.6:
            agent.stability_rounds += 1
            agent.conviction = min(1.0, agent.conviction + 0.1)
        else:
            if old:
                agent.history.append(old)
            agent.stability_rounds = 1
            agent.conviction = max(0.2, agent.conviction - 0.2)
            agent.opinion = new_opinion

        return new_opinion != old, agent.opinion

    def pairwise_distances(self) -> Dict[str, float]:
        """计算所有 Agent 之间的观点距离"""
        dists: Dict[str, float] = {}
        ids = list(self.agents.keys())
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a = self.agents[ids[i]].opinion
                b = self.agents[ids[j]].opinion
                if a and b:
                    dists[f"{ids[i]}↔{ids[j]}"] = round(
                        1.0 - _jaccard(_tokenize_zh(a), _tokenize_zh(b)), 4
                    )
        return dists

    def convergence_score(self, β: int = 3) -> dict:
        """计算当前收敛状态"""
        all_stable = all(a.stability_rounds >= β for a in self.agents.values())
        dists = self.pairwise_distances()
        avg_dist = round(sum(dists.values()) / max(len(dists), 1), 4) if dists else 1.0

        return {
            "allStable": all_stable,
            "avgDistance": avg_dist,
            "isConverged": all_stable and avg_dist < 0.35,
            "stabilityRounds": {aid: a.stability_rounds for aid, a in self.agents.items()},
            "convictions": {aid: round(a.conviction, 2) for aid, a in self.agents.items()},
        }

    def create_snapshot(self, session_id: str, turn: int) -> OpinionSnapshot:
        """创建当前轮的观点快照"""
        dists = self.pairwise_distances()
        avg = round(sum(dists.values()) / max(len(dists), 1), 4) if dists else 1.0
        snap = OpinionSnapshot(
            session_id=session_id,
            turn=turn,
            agent_opinions={aid: a.opinion for aid, a in self.agents.items()},
            pairwise_distances=dists,
            avg_distance=avg,
            all_stable=all(a.stability_rounds >= 2 for a in self.agents.values()),
            timestamp=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        )
        self.snapshots.append(snap)
        return snap


def _fallback_extract(text: str) -> str:
    """LLM 不可用时的本地关键词回退"""
    text_l = text[:200].lower()
    if any(w in text_l for w in ("同意", "支持", "有道理", "赞成")):
        return "支持当前讨论方向"
    if any(w in text_l for w in ("反对", "不行", "错误", "不合理")):
        return "反对当前讨论方向"
    if any(w in text_l for w in ("想", "希望", "觉得", "认为", "应该")):
        return text[:30].strip()
    return text[:30].strip() if text.strip() else "未表达明确观点"
