#!/usr/bin/env bash
# ============================================================
# SGLang LoRA 调用验证脚本
# 用法: bash verify_lora.sh
#
# 对每个 SGLang 服务发送带 lora_name 的请求，
# 检查响应和日志中是否正确使用了 LoRA adapter。
# ============================================================
set -euo pipefail

LLAMA3_PORT="${1:-8001}"
QWEN3_PORT="${2:-8002}"
LOG_DIR="${3:-./deploy/logs}"

green()  { echo -e "\033[32m$*\033[0m"; }
cyan()   { echo -e "\033[36m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }

MBTI_SAMPLES=("ISTJ" "ENFP" "INFJ" "ESTP")

echo ""
cyan "╔═══════════════════════════════════════╗"
cyan "║   SGLang LoRA 调用验证                ║"
cyan "╚═══════════════════════════════════════╝"
echo ""

# ─── 基础健康检查 ───
for port in "$LLAMA3_PORT" "$QWEN3_PORT"; do
  echo -n "健康检查 :$port ... "
  if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
    green "OK"
  else
    yellow "未响应 (跳过)"
  fi
done

# ─── LoRA 调用测试 ───
test_lora() {
  local name="$1"
  local port="$2"
  local mbti="$3"

  echo ""
  cyan "--- 测试 $name 使用 $mbti LoRA ---"

  local MODEL_ID="$name:$mbti"
  local RESPONSE
  RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:$port/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$(cat <<EOF
{
  "model": "$MODEL_ID",
  "messages": [{"role": "user", "content": "简单介绍你的MBTI性格"}],
  "max_tokens": 100,
  "temperature": 0.7
}
EOF
)") || true

  local HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  local BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" == "200" ]]; then
    local REPLY=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['choices'][0]['message']['content'][:120])" 2>/dev/null || echo "(解析失败)")
    green "  ✓ HTTP 200, model=$MODEL_ID"
    echo "  📝 $REPLY"
  else
    yellow "  ✗ HTTP $HTTP_CODE"
    echo "  body: ${BODY:0:200}"
  fi
}

# 测试各模型+MBTI组合
for mbti in "${MBTI_SAMPLES[@]}"; do
  test_lora "llama3.1" "$LLAMA3_PORT" "$mbti"
  test_lora "qwen3"    "$QWEN3_PORT"  "$mbti"
done

# ─── 日志分析: 统计 LoRA 调用次数 ───
echo ""
cyan "--- SGLang 日志中的 LoRA 调用统计 ---"

for log_name in sglang_llama3 sglang_qwen3; do
  local log_file="$LOG_DIR/$log_name.log"
  if [[ -f "$log_file" ]]; then
    echo ""
    cyan ">>> $log_name"
    echo -n "  LoRA 请求数: "
    grep -c "lora_name\|Prepared LoRA" "$log_file" 2>/dev/null || echo "0"
    echo "  最近 5 条 LoRA 记录:"
    grep -i "lora" "$log_file" 2>/dev/null | tail -5 | while read -r line; do
      echo "    $line"
    done || echo "    (无记录)"
  else
    yellow "  $log_name: 日志文件不存在 ($log_file)"
  fi
done

echo ""
green "验证完成. 使用 tail -f $LOG_DIR/sglang_*.log 实时监控 LoRA 调用."
