#!/usr/bin/env bash
# ============================================================
# SGLang LoRA 调用验证脚本
# 用法: bash verify_lora.sh [llama3_port] [qwen3_port]
#
# 对每个 SGLang 服务发送带 LoRA adapter 的请求,
# 检查响应和日志中是否正确使用了 LoRA。
# ============================================================
set -euo pipefail

LLAMA3_PORT="${1:-8001}"
QWEN3_PORT="${2:-8002}"

green()  { echo -e "\033[32m$*\033[0m"; }
cyan()   { echo -e "\033[36m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }

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
    yellow "未响应"
  fi
done
echo ""

# ─── LoRA adapter 列表 ───
for port in "$LLAMA3_PORT" "$QWEN3_PORT"; do
  echo -n "已加载 LoRA (:${port}) ... "
  MODELS=$(curl -s "http://127.0.0.1:$port/v1/models" 2>/dev/null || echo "{}")
  echo "$MODELS" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for m in d.get('data',[]):
    print(f\"  {m.get('id','?')}\")
except: print('  (无法解析)')
" 2>/dev/null || echo "  (接口不可用)"
  echo ""
done

# ─── LoRA 调用测试 ───
test_lora() {
  local model_name="$1"  # e.g. "llama3.1"
  local port="$2"
  local mbti="$3"

  local model_id="${model_name}:${mbti}"
  echo ">>> 测试 ${model_id} (port $port)"

  RESPONSE=$(curl -s -w "\n%{http_code}" "http://127.0.0.1:$port/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
      "model": "'"$model_id"'",
      "messages": [{"role": "user", "content": "用中文说一句话介绍你的性格"}],
      "max_tokens": 80,
      "temperature": 0.7
    }') || true

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [[ "$HTTP_CODE" == "200" ]]; then
    REPLY=$(echo "$BODY" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print(d['choices'][0]['message']['content'][:120])
except: print('(解析失败)')
" 2>/dev/null || echo "(解析失败)")
    green "  ✓ HTTP 200"
    echo "  → $REPLY"
  else
    yellow "  ✗ HTTP $HTTP_CODE"
    echo "  body: ${BODY:0:200}"
  fi
  echo ""
}

MBTI_SAMPLES=("ISTJ" "ENFP" "INFJ" "ESTP")

for mbti in "${MBTI_SAMPLES[@]}"; do
  test_lora "llama3.1" "$LLAMA3_PORT" "$mbti"
done

for mbti in "${MBTI_SAMPLES[@]}"; do
  test_lora "qwen3" "$QWEN3_PORT" "$mbti"
done

echo ""
green "验证完成。"
