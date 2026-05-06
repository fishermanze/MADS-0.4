#!/usr/bin/env python3
"""
实验数据分析脚本

从 run_experiment.py 输出的 CSV 中生成论文用统计表格和图表数据。

用法:
  python scripts/analyze_results.py experiments/output/router_strategies_20260101_120000.csv

输出:
  - 每个条件的聚合统计（收敛轮次、发言均衡度、延迟等）
  - 实验间对比表（可直接粘贴到论文 LaTeX 表格）
"""

import argparse
import csv
import sys
from collections import defaultdict
from typing import Any, Dict, List


def load_csv(path: str) -> List[Dict[str, Any]]:
    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            for k in ("round", "run", "latency_ms"):
                if k in row and row[k]:
                    row[k] = int(float(row[k]))
            for k in ("convergence_score", "goal_score", "emotion_score",
                      "cooldown_score", "diversity_score", "mbti_score",
                      "sentiment_valence", "sentiment_arousal", "temperature"):
                if k in row and row[k]:
                    row[k] = float(row[k])
            rows.append(row)
    return rows


def analyze(rows: List[Dict[str, Any]]):
    by_cond: Dict[str, List[Dict]] = defaultdict(list)
    for r in rows:
        by_cond[r["condition"]].append(r)

    print("=" * 90)
    print("                    MADS 实验数据分析")
    print("=" * 90)

    # ── 每条件聚合统计 ──
    print("\n── 条件级聚合统计 ──\n")
    for cond_name, recs in by_cond.items():
        rounds = [int(r["round"]) for r in recs]
        max_round = max(rounds) if rounds else 0
        avg_round = sum(rounds) / len(rounds) if rounds else 0

        latencies = [r["latency_ms"] for r in recs if r.get("latency_ms")]
        avg_lat = sum(latencies) / len(latencies) if latencies else 0

        conv_scores = [r["convergence_score"] for r in recs if r.get("convergence_score", 0) > 0]
        avg_conv = sum(conv_scores) / len(conv_scores) if conv_scores else 0

        stops = sum(1 for r in recs if r.get("should_stop") in ("True", "true", True))
        speakers = set(r["speaker"] for r in recs if r.get("speaker"))

        # 发言均衡度: 各发言人发言次数的方差
        speak_counts = defaultdict(int)
        for r in recs:
            speak_counts[r.get("speaker", "?")] += 1
        counts = list(speak_counts.values())
        balance = 1.0 - (max(counts) - min(counts)) / max(counts, 1) if len(counts) > 1 else 1.0

        # 重复发言率: 相邻两轮 content 相似度
        contents = [r.get("content", "") for r in recs]
        dupes = 0
        for i in range(1, len(contents)):
            if contents[i] and contents[i - 1]:
                a, b = set(contents[i]), set(contents[i - 1])
                if len(a | b) > 0 and len(a & b) / len(a | b) > 0.5:
                    dupes += 1
        dup_rate = dupes / max(len(contents) - 1, 1) if len(contents) > 1 else 0

        avg_sentiment = sum(r.get("sentiment_valence", 0) for r in recs) / len(recs) if recs else 0

        print(f"  [{cond_name}]")
        print(f"    样本: {len(recs)}轮  {len(speakers)}个发言人  maxRound={max_round}  avgRound={avg_round:.1f}")
        print(f"    avgLatency={avg_lat:.0f}ms  avgConvergence={avg_conv:.3f}")
        print(f"    speakerBalance={balance:.3f}  duplicateRate={dup_rate:.3f}  avgSentiment={avg_sentiment:.3f}")
        print()

    # ── 对比表（可直接用于论文） ──
    print("── 实验对比表（可粘贴到 LaTeX） ──\n")

    headers = ["条件", "样本轮次", "平均轮次", "发言人", "发言均衡度", "平均延迟(ms)", "重复发言率", "平均情感"]
    col_widths = [max(len(h), 20) for h in headers]
    sep = "  ".join("-" * w for w in col_widths)

    print(sep)
    print("  ".join(h.ljust(w) for h, w in zip(headers, col_widths)))
    print(sep)

    for cond_name, recs in by_cond.items():
        rounds = [int(r["round"]) for r in recs]
        max_round = max(rounds) if rounds else 0
        avg_round = sum(rounds) / len(rounds) if rounds else 0
        latencies = [r["latency_ms"] for r in recs if r.get("latency_ms")]
        avg_lat = sum(latencies) / len(latencies) if latencies else 0
        speakers = len(set(r["speaker"] for r in recs if r.get("speaker")))
        speak_counts = defaultdict(int)
        for r in recs:
            speak_counts[r.get("speaker", "?")] += 1
        counts = list(speak_counts.values())
        balance = 1.0 - (max(counts) - min(counts)) / max(counts, 1) if len(counts) > 1 else 1.0

        contents = [r.get("content", "") for r in recs]
        dupes = 0
        for i in range(1, len(contents)):
            if contents[i] and contents[i - 1]:
                a, b = set(contents[i]), set(contents[i - 1])
                if len(a | b) > 0 and len(a & b) / len(a | b) > 0.5:
                    dupes += 1
        dup_rate = dupes / max(len(contents) - 1, 1) if len(contents) > 1 else 0

        avg_sent = sum(r.get("sentiment_valence", 0) for r in recs) / len(recs) if recs else 0

        vals = [
            cond_name,
            str(len(recs)),
            f"{avg_round:.1f}",
            str(speakers),
            f"{balance:.3f}",
            f"{avg_lat:.0f}",
            f"{dup_rate:.3f}",
            f"{avg_sent:.3f}",
        ]
        print("  ".join(v.ljust(w) for v, w in zip(vals, col_widths)))

    print(sep)
    print()


def main():
    parser = argparse.ArgumentParser(description="MADS 实验数据分析")
    parser.add_argument("csv_file", help="run_experiment.py 输出的 CSV 文件")
    args = parser.parse_args()

    rows = load_csv(args.csv_file)
    if not rows:
        print("CSV 为空", file=sys.stderr)
        sys.exit(1)

    analyze(rows)


if __name__ == "__main__":
    main()
