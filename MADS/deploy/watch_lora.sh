#!/usr/bin/env bash
# ============================================================
# 实时监控 SGLang LoRA 调用
# 用法: bash watch_lora.sh
#
# 每 2 秒刷新, 显示最近 10 条 LoRA 相关的日志行.
# ============================================================
set -euo pipefail

LOG_DIR="${1:-$PWD/deploy/logs}"

cyan() { echo -e "\033[36m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }

cyan "实时监控 SGLang LoRA 调用 (Ctrl+C 退出)"
cyan "日志目录: $LOG_DIR"
echo ""

while true; do
  clear 2>/dev/null || true
  echo "══════════════════════════════════════ $(date '+%H:%M:%S')"
  echo ""

  for log in "$LOG_DIR"/sglang_*.log; do
    if [[ -f "$log" ]]; then
      local name=$(basename "$log" .log)
      echo "─── $name ───"
      grep -i "lora" "$log" 2>/dev/null | tail -10 | while read -r line; do
        echo "  $line"
      done || echo "  (暂无 LoRA 调用记录)"
      echo ""
    fi
  done

  sleep 2
done
