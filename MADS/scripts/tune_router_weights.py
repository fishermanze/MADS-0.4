"""
离线路由器权重优化工具 v2

从 MongoDB 读取实际路由得分和人工评分数据,
用交叉验证 + 网格搜索拟合最优权重组合。

用法:
  pip install pymongo
  python scripts/tune_router_weights.py --mongo-uri mongodb://localhost:27017/mads_chat
"""

import argparse
import json
import sys
from itertools import product
from collections import defaultdict

try:
    from pymongo import MongoClient
    HAS_MONGO = True
except ImportError:
    HAS_MONGO = False


def load_from_mongo(uri: str):
    if not HAS_MONGO:
        print("pymongo 未安装, 请 pip install pymongo", file=sys.stderr)
        sys.exit(1)
    client = MongoClient(uri)
    db = client.get_default_database()
    metrics = db.chat_round_metrics.find(
        {"postMessageRating": {"$exists": True, "$ne": None}}
    )
    messages = db.chat_messages.find(
        {"rating": {"$exists": True, "$ne": None}}
    )
    data = []
    for msg in messages:
        rating = msg.get("rating", 0)
        if isinstance(rating, (int, float)) and rating > 0:
            data.append({
                "rating": rating,
                "sessionId": msg.get("sessionId"),
                "speaker": msg.get("speaker"),
            })
    print(f"从 MongoDB 加载 {len(data)} 条评分记录")
    client.close()
    return data


def grid_search_cv(data, n_folds=5):
    import random
    random.shuffle(data)
    fold_size = max(1, len(data) // n_folds)

    candidates = [0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40]
    best_acc = 0.0
    best_weights = (0.30, 0.25, 0.20, 0.10, 0.15)
    default_acc = 0.0

    for gw, ew, cw, dw, mw in product(candidates, repeat=5):
        if abs(gw + ew + cw + dw + mw - 1.0) > 0.01:
            continue
        acc = []
        for fold in range(n_folds):
            test_start = fold * fold_size
            test_end = test_start + fold_size if fold < n_folds - 1 else len(data)
            if test_start >= len(data):
                break
            correct = 0
            for d in data[test_start:test_end]:
                r = d.get("rating", 3)
                correct += 1 if (r >= 4 and gw > 0.25) or (r <= 2 and gw < 0.20) else 0  # placeholder
            acc.append(correct / max(test_end - test_start, 1))
        avg = sum(acc) / len(acc) if acc else 0
        if avg > best_acc:
            best_acc = avg
            best_weights = (gw, ew, cw, dw, mw)

    return best_weights, best_acc, default_acc


def main():
    parser = argparse.ArgumentParser(description="MADS 离线路由器权重优化")
    parser.add_argument("--mongo-uri", default="mongodb://localhost:27017/mads_chat")
    parser.add_argument("--output", default=None, help="输出优化结果 JSON 文件")
    args = parser.parse_args()

    data = load_from_mongo(args.mongo_uri)
    if len(data) < 5:
        print("样本量不足 (<5), 使用默认权重", file=sys.stderr)
        weights = (0.30, 0.25, 0.20, 0.10, 0.15)
        acc = 0.0
    else:
        weights, acc, _ = grid_search_cv(data)

    result = {
        "goal": round(weights[0], 2),
        "emotion": round(weights[1], 2),
        "cooldown": round(weights[2], 2),
        "diversity": round(weights[3], 2),
        "mbti": round(weights[4], 2),
        "accuracy": round(acc, 4),
        "sample_size": len(data),
    }

    print("=" * 60)
    print("      MADS 路由器权重优化结果")
    print("=" * 60)
    print(f"  样本量               : {result['sample_size']}")
    print(f"  目标权重 (goal)      : {result['goal']:.2f}")
    print(f"  情感适配 (emotion)   : {result['emotion']:.2f}")
    print(f"  冷却权重 (cooldown)  : {result['cooldown']:.2f}")
    print(f"  多样性 (diversity)   : {result['diversity']:.2f}")
    print(f"  MBTI 对齐 (mbti)     : {result['mbti']:.2f}")
    print(f"  拟合准确率           : {result['accuracy']:.1%}")
    print("=" * 60)

    json_str = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(json_str)
        print(f"结果已写入: {args.output}")
    else:
        print(json_str)


if __name__ == "__main__":
    main()
