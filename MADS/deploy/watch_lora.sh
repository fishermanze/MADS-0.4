#!/usr/bin/env bash
# ============================================================
# 实时监控 SGLang LoRA 调用
# 用法: bash watch_lora.sh [log_dir]
#
# 查看 SGLang server 日志中最近使用到的 LoRA adapter。
# SGLang --log-requests 会在每次请求时打印使用的 model (含 adapter 名).
# ============================================================
set -euo pipefail

LOG_DIR="${1:-$PWD/deploy/logs}"

cyan() { echo -e "\033[36m$*\033[0m"; }

cyan "实时监控 SGLang LoRA 调用 (Ctrl+C 退出)"
cyan "日志目录: $LOG_DIR"
cyan "提示: 如果看不到 LoRA 记录, 请确认 SGLang 启动了 --log-requests"
echo ""

while true; do
  clear 2>/dev/null || true
  echo "══════════════════════════════════════ $(date '+%H:%M:%S')"
  echo ""

  for log in "$LOG_DIR"/sglang_*.log; do
    if [[ -f "$log" ]]; then
      local_name=$(basename "$log" .log)
      echo "─── $local_name ───"
      # SGLang log-requests 格式: "model": "name:adapter" 或 lora_path
      grep -E 'model.*:|lora' "$log" 2>/dev/null | tail -5 | while read -r line; do
        # 只显示 model-lora 相关行
        echo "  $line"
      done || echo "  (暂无 LoRA 调用记录)"
      echo ""
    fi
  done

  sleep 2
done
