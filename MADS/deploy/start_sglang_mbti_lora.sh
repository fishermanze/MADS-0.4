#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# SGLang Dynamic LoRA 启动脚本 — 8×RTX 3090
# ============================================================
# 架构:
#   GPU 0-3: llama3.1-8B  base + 16 MBTI LoRA  →  :8001
#   GPU 4-7: qwen3-8B     base + 16 MBTI LoRA  →  :8002
#
# 每个请求的 LoRA 调用记录在 SGLang server 日志中 (INFO 级别).
# 同时 Python gateway 也会在日志中打印 "route_source=…+mbti_lora".
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$SCRIPT_DIR")}"

# ==================== 基础路径 (按你的服务器修改) ====================
MODEL_DIR="${MODEL_DIR:-/data/models}"
LLAMA3_BASE="${LLAMA3_BASE:-$MODEL_DIR/llama3.1-8b-instruct}"
QWEN3_BASE="${QWEN3_BASE:-$MODEL_DIR/qwen3-8b-instruct}"

# LoRA 适配器根目录, 每个目录名 = LoRA 名称 (ISTJ, ISFJ, ...)
LLAMA3_LORA_DIR="${LLAMA3_LORA_DIR:-$MODEL_DIR/loras/llama3.1-8b-mbti}"
QWEN3_LORA_DIR="${QWEN3_LORA_DIR:-$MODEL_DIR/loras/qwen3-8b-mbti}"

# ==================== 端口 ====================
LLAMA3_PORT="${LLAMA3_PORT:-8001}"
QWEN3_PORT="${QWEN3_PORT:-8002}"
GATEWAY_PORT="${GATEWAY_PORT:-9001}"

# ==================== 日志目录 ====================
LOG_DIR="$PROJECT_ROOT/deploy/logs"
mkdir -p "$LOG_DIR"

# ==================== Python 环境 ====================
PYTHON_BIN="${PYTHON_BIN:-python3}"
SGLANG_LAUNCH="${SGLANG_LAUNCH:-python3 -m sglang.launch_server}"

# ==================== 16 MBTI 类型 ====================
MBTI_TYPES=(
  ISTJ ISFJ INFJ INTJ
  ISTP ISFP INFP INTP
  ESTP ESFP ENFP ENTP
  ESTJ ESFJ ENFJ ENTJ
)

# ==================== 辅助函数 ====================

red()    { echo -e "\033[31m$*\033[0m"; }
green()  { echo -e "\033[32m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
cyan()   { echo -e "\033[36m$*\033[0m"; }

log_info()  { green  "[INFO]  $*"; }
log_warn()  { yellow "[WARN]  $*"; }
log_error() { red    "[ERROR] $*"; }

# 为指定 base model 生成 SGLang lora-paths JSON 文件
# 参数: $1=LoRA目录, $2=输出JSON路径
generate_lora_config() {
  local lora_dir="$1"
  local out_json="$2"

  echo "{" > "$out_json"
  local first=true
  for mbti in "${MBTI_TYPES[@]}"; do
    local adapter_path="$lora_dir/$mbti"
    if [[ ! -d "$adapter_path" ]]; then
      log_warn "LoRA adapter 不存在: $adapter_path (跳过)"
      continue
    fi
    if $first; then first=false; else echo "," >> "$out_json"; fi
    printf '  "%s": "%s"' "$mbti" "$adapter_path" >> "$out_json"
  done
  echo "" >> "$out_json"
  echo "}" >> "$out_json"
  log_info "生成 lora config: $out_json"
}

# 验证 base model 和至少部分 LoRA 存在
check_prerequisites() {
  local ok=true

  if [[ ! -d "$LLAMA3_BASE" ]]; then
    log_error "llama3.1 base model 未找到: $LLAMA3_BASE"
    ok=false
  else
    log_info "llama3.1 base: $LLAMA3_BASE ✓"
  fi

  if [[ ! -d "$QWEN3_BASE" ]]; then
    log_warn "qwen3 base model 未找到: $QWEN3_BASE (跳过, 仅启动 llama3)"
  else
    log_info "qwen3 base:     $QWEN3_BASE ✓"
  fi

  for d in "$LLAMA3_LORA_DIR" "$QWEN3_LORA_DIR"; do
    if [[ ! -d "$d" ]]; then
      log_warn "LoRA 目录不存在: $d (将跳过缺失的 adapter)"
    else
      local count=$(find "$d" -maxdepth 1 -name "adapter_config.json" | wc -l)
      log_info "LoRA 目录: $d (找到 $count 个 adapter)"
    fi
  done

  if ! $ok; then
    log_error "前置条件检查失败, 退出"
    exit 1
  fi
}

# 启动单个 SGLang server
# 参数: $1=名称 $2=端口 $3=base_model路径 $4=GPU范围(如 "0,1,2,3") $5=lora_config_json $6=日志文件路径
start_sglang() {
  local name="$1"
  local port="$2"
  local base_model="$3"
  local gpus="$4"
  local lora_config="$5"
  local log_file="$6"

  echo ""
  cyan "========================================"
  cyan "  启动 SGLang: $name"
  cyan "  端口: $port    GPU: $gpus"
  cyan "  base: $(basename "$base_model")"
  cyan "========================================"

  CUDA_VISIBLE_DEVICES="$gpus" nohup python3 -m sglang.launch_server \
    --host 0.0.0.0 \
    --port "$port" \
    --model-path "$base_model" \
    --served-model-name "$name" \
    --enable-lora \
    --lora-paths "$lora_config" \
    --max-loras-per-request 1 \
    --max-lora-rank 64 \
    --max-running-requests 32 \
    --tp-size 4 \
    --mem-fraction-static 0.85 \
    --log-level info \
    --log-requests \
    --show-time-cost \
    --enable-metrics \
    > "$log_file" 2>&1 &

  local pid=$!
  log_info "$name 已启动 (PID=$pid), 日志: $log_file"

  # 等待 server 就绪
  log_info "等待 $name 就绪 ..."
  for i in $(seq 1 120); do
    if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
      green "  ✓ $name 就绪 (port $port)"
      return 0
    fi
    sleep 2
  done
  red "  ✗ $name 启动超时, 检查日志: $log_file"
  return 1
}

# ==================== 主流程 ====================

echo ""
cyan "╔══════════════════════════════════════════╗"
cyan "║   MADS SGLang Dynamic LoRA 启动器       ║"
cyan "║   8×RTX 3090 — 2 base + 32 LoRA         ║"
cyan "╚══════════════════════════════════════════╝"
echo ""

echo "模型目录:     $MODEL_DIR"
echo "llama3 base:  $LLAMA3_BASE"
echo "qwen3 base:   $QWEN3_BASE"
echo "llama3 LoRA:  $LLAMA3_LORA_DIR"
echo "qwen3 LoRA:   $QWEN3_LORA_DIR"
echo "日志目录:     $LOG_DIR"
echo ""

check_prerequisites

# ─── 生成 LoRA 配置文件 ───
LLAMA3_LORA_JSON="$LOG_DIR/llama3_lora_config.json"
QWEN3_LORA_JSON="$LOG_DIR/qwen3_lora_config.json"
generate_lora_config "$LLAMA3_LORA_DIR" "$LLAMA3_LORA_JSON"
generate_lora_config "$QWEN3_LORA_DIR" "$QWEN3_LORA_JSON"

# ─── 设置 MADS 网关环境变量 ───
export MADS_MODEL_REGISTRY_JSON='{
  "default_model_id": "llama3-isfj",
  "models": [
    {
      "model_id": "llama3-istj","display_name": "llama3.1-ISTJ","endpoint": "http://127.0.0.1:8001/v1","api_key": "EMPTY","base_model": "llama3.1","lora_name": "ISTJ","model": "llama3.1","priority": 80,"tags": ["llama3","ISTJ"]
    },
    {"model_id":"llama3-isfj","display_name":"llama3.1-ISFJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ISFJ","model":"llama3.1","priority":80,"tags":["llama3","ISFJ"]},
    {"model_id":"llama3-infj","display_name":"llama3.1-INFJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"INFJ","model":"llama3.1","priority":80,"tags":["llama3","INFJ"]},
    {"model_id":"llama3-intj","display_name":"llama3.1-INTJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"INTJ","model":"llama3.1","priority":80,"tags":["llama3","INTJ"]},
    {"model_id":"llama3-istp","display_name":"llama3.1-ISTP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ISTP","model":"llama3.1","priority":80,"tags":["llama3","ISTP"]},
    {"model_id":"llama3-isfp","display_name":"llama3.1-ISFP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ISFP","model":"llama3.1","priority":80,"tags":["llama3","ISFP"]},
    {"model_id":"llama3-infp","display_name":"llama3.1-INFP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"INFP","model":"llama3.1","priority":80,"tags":["llama3","INFP"]},
    {"model_id":"llama3-intp","display_name":"llama3.1-INTP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"INTP","model":"llama3.1","priority":80,"tags":["llama3","INTP"]},
    {"model_id":"llama3-estp","display_name":"llama3.1-ESTP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ESTP","model":"llama3.1","priority":80,"tags":["llama3","ESTP"]},
    {"model_id":"llama3-esfp","display_name":"llama3.1-ESFP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ESFP","model":"llama3.1","priority":80,"tags":["llama3","ESFP"]},
    {"model_id":"llama3-enfp","display_name":"llama3.1-ENFP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ENFP","model":"llama3.1","priority":80,"tags":["llama3","ENFP"]},
    {"model_id":"llama3-entp","display_name":"llama3.1-ENTP","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ENTP","model":"llama3.1","priority":80,"tags":["llama3","ENTP"]},
    {"model_id":"llama3-estj","display_name":"llama3.1-ESTJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ESTJ","model":"llama3.1","priority":80,"tags":["llama3","ESTJ"]},
    {"model_id":"llama3-esfj","display_name":"llama3.1-ESFJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ESFJ","model":"llama3.1","priority":80,"tags":["llama3","ESFJ"]},
    {"model_id":"llama3-enfj","display_name":"llama3.1-ENFJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ENFJ","model":"llama3.1","priority":80,"tags":["llama3","ENFJ"]},
    {"model_id":"llama3-entj","display_name":"llama3.1-ENTJ","endpoint":"http://127.0.0.1:8001/v1","api_key":"EMPTY","base_model":"llama3.1","lora_name":"ENTJ","model":"llama3.1","priority":80,"tags":["llama3","ENTJ"]},
    {"model_id":"qwen3-istj","display_name":"qwen3-ISTJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ISTJ","model":"qwen3","priority":70,"tags":["qwen","ISTJ"]},
    {"model_id":"qwen3-isfj","display_name":"qwen3-ISFJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ISFJ","model":"qwen3","priority":70,"tags":["qwen","ISFJ"]},
    {"model_id":"qwen3-infj","display_name":"qwen3-INFJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"INFJ","model":"qwen3","priority":70,"tags":["qwen","INFJ"]},
    {"model_id":"qwen3-intj","display_name":"qwen3-INTJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"INTJ","model":"qwen3","priority":70,"tags":["qwen","INTJ"]},
    {"model_id":"qwen3-istp","display_name":"qwen3-ISTP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ISTP","model":"qwen3","priority":70,"tags":["qwen","ISTP"]},
    {"model_id":"qwen3-isfp","display_name":"qwen3-ISFP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ISFP","model":"qwen3","priority":70,"tags":["qwen","ISFP"]},
    {"model_id":"qwen3-infp","display_name":"qwen3-INFP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"INFP","model":"qwen3","priority":70,"tags":["qwen","INFP"]},
    {"model_id":"qwen3-intp","display_name":"qwen3-INTP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"INTP","model":"qwen3","priority":70,"tags":["qwen","INTP"]},
    {"model_id":"qwen3-estp","display_name":"qwen3-ESTP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ESTP","model":"qwen3","priority":70,"tags":["qwen","ESTP"]},
    {"model_id":"qwen3-esfp","display_name":"qwen3-ESFP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ESFP","model":"qwen3","priority":70,"tags":["qwen","ESFP"]},
    {"model_id":"qwen3-enfp","display_name":"qwen3-ENFP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ENFP","model":"qwen3","priority":70,"tags":["qwen","ENFP"]},
    {"model_id":"qwen3-entp","display_name":"qwen3-ENTP","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ENTP","model":"qwen3","priority":70,"tags":["qwen","ENTP"]},
    {"model_id":"qwen3-estj","display_name":"qwen3-ESTJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ESTJ","model":"qwen3","priority":70,"tags":["qwen","ESTJ"]},
    {"model_id":"qwen3-esfj","display_name":"qwen3-ESFJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ESFJ","model":"qwen3","priority":70,"tags":["qwen","ESFJ"]},
    {"model_id":"qwen3-enfj","display_name":"qwen3-ENFJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ENFJ","model":"qwen3","priority":70,"tags":["qwen","ENFJ"]},
    {"model_id":"qwen3-entj","display_name":"qwen3-ENTJ","endpoint":"http://127.0.0.1:8002/v1","api_key":"EMPTY","base_model":"qwen3","lora_name":"ENTJ","model":"qwen3","priority":70,"tags":["qwen","ENTJ"]}
  ]
}'

export MADS_MODEL_REGISTRY_TTL_SECONDS="60"
export MADS_MBTI_LORA_MAP='{"ISTJ":"ISTJ","ISFJ":"ISFJ","INFJ":"INFJ","INTJ":"INTJ","ISTP":"ISTP","ISFP":"ISFP","INFP":"INFP","INTP":"INTP","ESTP":"ESTP","ESFP":"ESFP","ENFP":"ENFP","ENTP":"ENTP","ESTJ":"ESTJ","ESFJ":"ESFJ","ENFJ":"ENFJ","ENTJ":"ENTJ"}'
export MADS_GATEWAY_PORT="$GATEWAY_PORT"
export MADS_DISABLE_CLIENT_CACHE="false"
export MADS_AGENT_RUN_TIMEOUT_SECONDS="120"

# ─── 启动 SGLang 服务 ───
start_sglang "llama3.1" "$LLAMA3_PORT" "$LLAMA3_BASE" "0,1,2,3" "$LLAMA3_LORA_JSON" "$LOG_DIR/sglang_llama3.log"
start_sglang "qwen3"    "$QWEN3_PORT"  "$QWEN3_BASE"  "4,5,6,7" "$QWEN3_LORA_JSON"  "$LOG_DIR/sglang_qwen3.log"

# ─── 启动 MADS 网关 ───
echo ""
cyan "========================================"
cyan "  启动 MADS Gateway (port $GATEWAY_PORT)"
cyan "========================================"

cd "$PROJECT_ROOT"
exec "$PYTHON_BIN" ./autogen_gateway.py
