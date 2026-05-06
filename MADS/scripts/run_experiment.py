#!/usr/bin/env python3
"""
MADS 批量实验运行器 v1.0

读取 YAML 实验配置，自动创建会话、收集流式数据、导出 CSV。
支持多条件 × 多轮次 × 干预实验。

用法:
  python scripts/run_experiment.py experiments/router_strategies.yaml \
    --gateway http://localhost:9001 \
    --backend http://localhost:8080 \
    --token "$TOKEN" \
    --output experiments/output/
"""

import argparse
import asyncio
import csv
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import yaml


# ── 数据结构 ──────────────────────────────────────────

@dataclass
class ExperimentConfig:
    name: str
    scenario: str
    topic: str
    models: List[Dict[str, str]]
    runs_per_condition: int
    max_rounds: int
    conditions: List[Dict[str, Any]]
    metrics: List[str] = field(default_factory=list)

    @classmethod
    def from_yaml(cls, path: str) -> "ExperimentConfig":
        with open(path, encoding="utf-8") as f:
            raw = yaml.safe_load(f)
        return cls(
            name=raw.get("name", Path(path).stem),
            scenario=raw["scenario"],
            topic=raw["topic"],
            models=raw["models"],
            runs_per_condition=raw.get("runsPerCondition", 3),
            max_rounds=raw.get("maxRounds", 12),
            conditions=raw["conditions"],
            metrics=raw.get("metrics", []),
        )


@dataclass
class RoundRecord:
    condition: str
    run: int
    round: int
    speaker: str
    role_tag: str
    content: str
    latency_ms: int = 0
    convergence_score: float = 0.0
    should_stop: bool = False
    stop_reason: str = ""
    router_strategy: str = ""
    chosen_speaker: str = ""
    goal_score: float = 0.0
    emotion_score: float = 0.0
    cooldown_score: float = 0.0
    diversity_score: float = 0.0
    mbti_score: float = 0.0
    sentiment_valence: float = 0.0
    sentiment_arousal: float = 0.0
    temperature: float = 0.0


# ── SSE 客户端 ────────────────────────────────────────

class SSEListener:
    """监听 SSE 流并收集所有事件"""

    def __init__(self):
        self.records: List[RoundRecord] = []
        self._buffer = ""
        self._event_type = ""
        self._current_condition = ""
        self._current_run = 0
        self._current_round = 0
        self._round_data: Dict[str, Any] = {}

    async def collect(
        self,
        client: httpx.AsyncClient,
        url: str,
        body: Dict[str, Any],
        condition: str,
        run: int,
        timeout: int = 600,
    ):
        self._current_condition = condition
        self._current_run = run

        async with client.stream(
            "POST", url, json=body, timeout=timeout
        ) as resp:
            if resp.status_code != 200:
                print(f"  ✗ HTTP {resp.status_code}", file=sys.stderr)
                return

            async for line in resp.aiter_lines():
                if line.startswith("event: "):
                    self._event_type = line[7:].strip()
                elif line.startswith("data: "):
                    await self._handle_event(self._event_type, line[6:])
                    self._event_type = ""

    async def _handle_event(self, evt: str, data: str):
        try:
            payload = json.loads(data) if data else {}
        except json.JSONDecodeError:
            payload = {}

        if evt == "role_start":
            self._round_data = {"role_start": payload}
        elif evt == "role_end":
            self._round_data.update(payload)
            speaker = payload.get("speaker", "")
            role_tag = payload.get("roleTag", "")
            content = payload.get("content", "")
            latency = int(payload.get("latencyMs", 0))
            turn = int(payload.get("turn", self._current_round + 1))
            temp = float(payload.get("temperature", 0.0))
            self._current_round = turn
            self.records.append(RoundRecord(
                condition=self._current_condition,
                run=self._current_run,
                round=turn,
                speaker=speaker,
                role_tag=role_tag,
                content=content,
                latency_ms=latency,
                temperature=temp,
            ))
        elif evt == "router_decision":
            rd = payload
            if self.records:
                last = self.records[-1]
                last.router_strategy = rd.get("strategy", "")
                last.chosen_speaker = rd.get("chosen_agent_id", "")
                if rd.get("scores"):
                    for aid, sc in rd["scores"].items():
                        if isinstance(sc, dict):
                            last.goal_score = sc.get("goal", 0)
                            last.emotion_score = sc.get("emotion_fit", 0)
                            last.cooldown_score = sc.get("cooldown", 0)
                            last.diversity_score = sc.get("diversity", 0)
                            last.mbti_score = sc.get("mbti_align", 0)
                            break
        elif evt == "convergence":
            if self.records:
                last = self.records[-1]
                last.convergence_score = payload.get("score", 0.0)
                last.should_stop = payload.get("shouldStop", False)
                last.stop_reason = payload.get("reason", "")
        elif evt == "sentiment":
            if self.records:
                last = self.records[-1]
                last.sentiment_valence = payload.get("valence", 0.0)
                last.sentiment_arousal = payload.get("arousal", 0.0)
        elif evt == "done":
            pass


# ── 运行器 ────────────────────────────────────────────

class ExperimentRunner:
    def __init__(self, gateway_url: str, backend_url: str, token: str, output_dir: str):
        self.gateway_url = gateway_url.rstrip("/")
        self.backend_url = backend_url.rstrip("/")
        self.token = token
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.client: Optional[httpx.AsyncClient] = None

    async def run(self, config: ExperimentConfig):
        print(f"\n{'='*60}")
        print(f"  实验: {config.name}")
        print(f"  场景: {config.scenario}  话题: {config.topic}")
        print(f"  条件数: {len(config.conditions)}  × 重复: {config.runs_per_condition}")
        print(f"{'='*60}\n")

        all_records: List[RoundRecord] = []

        async with httpx.AsyncClient(timeout=httpx.Timeout(30)) as self.client:
            for cond in config.conditions:
                cond_name = cond.get("name", "unnamed")
                print(f"\n── 条件: {cond_name} ──")

                for run in range(1, config.runs_per_condition + 1):
                    print(f"  运行 {run}/{config.runs_per_condition} ...", end=" ")

                    try:
                        session_id = await self._create_session(config, cond)
                        listener = SSEListener()

                        body = self._build_gateway_body(session_id, config, cond)
                        stream_url = f"{self.gateway_url}/autogen/generate/stream"

                        await listener.collect(
                            self.client, stream_url, body, cond_name, run
                        )

                        # 干预处理
                        if cond.get("intervention") and listener.records:
                            await self._apply_intervention(
                                session_id, cond, listener, config
                            )
                            # 第二轮生成（干预后）
                            listener2 = SSEListener()
                            body2 = self._build_gateway_body(session_id, config, cond)
                            body2["userMessage"] = ""
                            await listener2.collect(
                                self.client, stream_url, body2, cond_name + "_post", run
                            )
                            listener.records.extend(listener2.records)

                        all_records.extend(listener.records)
                        print(f"✓ ({len(listener.records)} 轮)")

                    except Exception as e:
                        print(f"✗ {e}")
                        continue

                    await asyncio.sleep(1)  # 避免打爆服务

        self._write_csv(config, all_records)
        self._print_summary(config, all_records)

    async def _create_session(self, config: ExperimentConfig, cond: Dict) -> str:
        models = []
        for i, m in enumerate(config.models):
            models.append({
                "id": f"agent-{i}",
                "modelName": m.get("modelName", "llama3"),
                "mbti": m.get("mbti", "ISFJ"),
                "role": m.get("role", ""),
                "personaId": "",
                "personaName": "",
                "personaPrompt": "",
            })

        resp = await self.client.post(
            f"{self.backend_url}/api/chat/sessions",
            json={"topic": config.topic, "scenario": config.scenario, "models": models},
            headers={"Authorization": f"Bearer {self.token}"},
        )
        if resp.status_code != 200:
            raise RuntimeError(f"创建会话失败: {resp.status_code}")
        return resp.json()["id"]

    async def _apply_intervention(
        self, session_id: str, cond: Dict, listener: SSEListener, config: ExperimentConfig
    ):
        intervention = cond["intervention"]
        at_round = intervention.get("atRound", 4)
        if listener.records:
            anchor = next(
                (r for r in listener.records if int(r.round) >= at_round), None
            )
            if not anchor and listener.records:
                anchor = listener.records[-1]

        models = []
        for i, m in enumerate(config.models):
            mbti = m.get("mbti", "ISFJ")
            role = m.get("role", "")
            if role == intervention.get("agentRole"):
                mbti = intervention.get("toMbti", mbti)
            models.append({
                "id": f"agent-{i}", "modelName": m.get("modelName", "llama3"),
                "mbti": mbti, "role": role,
                "personaId": "", "personaName": "", "personaPrompt": "",
            })

        await self.client.patch(
            f"{self.backend_url}/api/chat/sessions/{session_id}/intervention",
            json={"models": models, "interventionMessageId": ""},
            headers={"Authorization": f"Bearer {self.token}"},
        )

    def _build_gateway_body(
        self, session_id: str, config: ExperimentConfig, cond: Dict
    ) -> Dict[str, Any]:
        models = []
        for i, m in enumerate(config.models):
            models.append({
                "id": f"agent-{i}",
                "modelName": m.get("modelName", "llama3"),
                "mbti": m.get("mbti", "ISFJ"),
                "role": m.get("role", ""),
                "personaId": "", "personaName": "", "personaPrompt": "",
            })

        body: Dict[str, Any] = {
            "sessionId": session_id,
            "topic": config.topic,
            "scenario": config.scenario,
            "userMessage": f"本轮讨论的主题是：{config.topic}。请各位角色基于自己的立场开始发言。",
            "models": models,
            "maxRounds": config.max_rounds,
            "routerEnabled": True,
            "routerStrategy": cond.get("strategy", "hybrid"),
            "convergenceThreshold": cond.get("convergenceThreshold") or None,
        }

        weights = cond.get("routerWeights")
        if weights:
            body["routerWeights"] = weights

        seed = cond.get("seed")
        if seed is not None:
            body["seed"] = int(seed)

        temp = cond.get("temperature")
        if temp is not None:
            body["temperature"] = float(temp)

        return body

    def _write_csv(self, config: ExperimentConfig, records: List[RoundRecord]):
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        path = self.output_dir / f"{config.name}_{ts}.csv"

        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=[
                "condition", "run", "round", "speaker", "role_tag",
                "latency_ms", "convergence_score", "should_stop",
                "router_strategy", "chosen_speaker",
                "goal_score", "emotion_score", "cooldown_score",
                "diversity_score", "mbti_score",
                "sentiment_valence", "sentiment_arousal",
                "temperature", "content",
            ])
            w.writeheader()
            for r in records:
                w.writerow({
                    "condition": r.condition, "run": r.run,
                    "round": r.round, "speaker": r.speaker,
                    "role_tag": r.role_tag,
                    "latency_ms": r.latency_ms,
                    "convergence_score": r.convergence_score,
                    "should_stop": r.should_stop,
                    "router_strategy": r.router_strategy,
                    "chosen_speaker": r.chosen_speaker,
                    "goal_score": r.goal_score,
                    "emotion_score": r.emotion_score,
                    "cooldown_score": r.cooldown_score,
                    "diversity_score": r.diversity_score,
                    "mbti_score": r.mbti_score,
                    "sentiment_valence": r.sentiment_valence,
                    "sentiment_arousal": r.sentiment_arousal,
                    "temperature": r.temperature,
                    "content": r.content[:500],
                })

        print(f"\n  CSV 已保存: {path}  ({len(records)} 行)")

    def _print_summary(self, config: ExperimentConfig, records: List[RoundRecord]):
        print(f"\n{'='*60}")
        print(f"  实验结果摘要")
        print(f"{'='*60}")

        from collections import defaultdict

        by_cond: Dict[str, List[RoundRecord]] = defaultdict(list)
        for r in records:
            by_cond[r.condition].append(r)

        for cond_name, recs in by_cond.items():
            rounds = max(set(r.round for r in recs), key=list(recs).count) if recs else 0
            avg_latency = sum(r.latency_ms for r in recs) / len(recs) if recs else 0
            avg_conv = sum(r.convergence_score for r in recs if r.convergence_score > 0) / max(
                sum(1 for r in recs if r.convergence_score > 0), 1
            )
            speakers = len(set(r.speaker for r in recs))

            print(f"  [{cond_name}]")
            print(f"    总轮次: {len(recs)}  最大轮: {rounds}  发言人: {speakers}")
            print(f"    平均延迟: {avg_latency:.0f}ms  平均收敛: {avg_conv:.3f}")


# ── CLI ───────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="MADS 批量实验运行器")
    parser.add_argument("config", help="实验配置 YAML 文件路径")
    parser.add_argument("--gateway", default="http://localhost:9001", help="Python 网关地址")
    parser.add_argument("--backend", default="http://localhost:8080", help="Java 后端地址")
    parser.add_argument("--token", help="JWT Bearer Token (可从 /api/auth/login 获取)")
    parser.add_argument("--output", default="experiments/output", help="输出目录")
    args = parser.parse_args()

    if not args.token:
        print("请提供 JWT Token: --token <your-token>", file=sys.stderr)
        sys.exit(1)

    config = ExperimentConfig.from_yaml(args.config)

    runner = ExperimentRunner(
        gateway_url=args.gateway,
        backend_url=args.backend,
        token=args.token,
        output_dir=args.output,
    )
    await runner.run(config)


if __name__ == "__main__":
    asyncio.run(main())
