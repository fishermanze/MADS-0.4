#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# SGLang Dynamic LoRA 启动脚本 — 8×RTX 3090
# ============================================================
# 架构:
#   GPU 0-3: llama3.1-8B  base + 16 MBTI LoRA  →  :8001
#   GPU 4-7: qwen3-8B     base + 16 MBTI LoRA  →  :8002
#
# LoRA 调用方式 (OpenAI compatible):
#   model: "llama3.1:ISTJ"  → 使用 ISTJ adapter
#   model: "llama3.1"       → base model (不使用 LoRA)
#
# 每个请求使用的 LoRA 在 SGLang 日志中可见 (--log-requests).
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$SCRIPT_DIR")}"
REGISTRY_PATH="${REGISTRY_PATH:-$PROJECT_ROOT/deploy/model_registry_qwen_only.json}"
# ==================== 基础路径 (按你的服务器修改) ====================
MODEL_DIR="${MODEL_DIR:-/nfs/huggingfacehub}"
LLAMA3_BASE="${LLAMA3_BASE:-$MODEL_DIR/Llama-3.1-8B-Instruct}"
QWEN3_BASE="${QWEN3_BASE:-$MODEL_DIR/Qwen3-8B}"

# LoRA 适配器根目录, 每个子目录名 = LoRA 名称 (ISTJ, ISFJ, ...)
LLAMA3_LORA_DIR="${LLAMA3_LORA_DIR:-/home/gaoze/pyCharmprj/loras/llama3.1-8b-mbti}"
QWEN3_LORA_DIR="${QWEN3_LORA_DIR:-/home/gaoze/pyCharmprj/loras/qwen3-8b-mbti}"

# ==================== 端口 ====================
LLAMA3_PORT="${LLAMA3_PORT:-8001}"
QWEN3_PORT="${QWEN3_PORT:-8002}"
GATEWAY_PORT="${GATEWAY_PORT:-9001}"

# ==================== 日志目录 ====================
LOG_DIR="$PROJECT_ROOT/deploy/logs"
mkdir -p "$LOG_DIR"

# ==================== Python 环境 ====================
PYTHON_BIN="${PYTHON_BIN:-python3}"

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

# 构建 --lora-paths 参数列表 (NAME=PATH 格式)
build_lora_args() {
  local lora_dir="$1"
  local args=()
  for mbti in "${MBTI_TYPES[@]}"; do
    local adapter_path="$lora_dir/$mbti"
    if [[ -d "$adapter_path" ]]; then
      args+=("$mbti=$adapter_path")
    else
      log_warn "LoRA adapter 不存在: $adapter_path (跳过)"
    fi
  done
  if [[ ${#args[@]} -eq 0 ]]; then
    log_error "未找到任何 LoRA adapter 在 $lora_dir"
    exit 1
  fi
  echo "${args[@]}"
}

# 验证 base model 存在
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
      log_warn "LoRA 目录不存在: $d"
    else
      local count=$(find "$d" -maxdepth 2 -name "adapter_config.json" | wc -l)
      log_info "LoRA 目录: $d (找到 $count 个 adapter)"
    fi
  done

  if ! $ok; then
    log_error "前置条件检查失败, 退出"
    exit 1
  fi
}

# 启动单个 SGLang server
start_sglang() {
  local name="$1"
  local port="$2"
  local base_model="$3"
  local gpus="$4"
  local lora_dir="$5"
  local log_file="$6"

  # 构建 --lora-paths 参数
  local lora_args
  lora_args=$(build_lora_args "$lora_dir")

  echo ""
  cyan "========================================"
  cyan "  启动 SGLang: $name"
  cyan "  端口: $port    GPU: $gpus"
  cyan "  base: $(basename "$base_model")"
  cyan "  LoRA: $lora_dir"
  cyan "========================================"

  # shellcheck disable=SC2086
  CUDA_VISIBLE_DEVICES="$gpus" "$PYTHON_BIN" -m sglang.launch_server \
    --host 0.0.0.0 \
    --port "$port" \
    --model-path "$base_model" \
    --served-model-name "$name" \
    --lora-paths $lora_args \
    --max-loras-per-batch 8 \
    --tp 8 \
    --log-requests \
    --enable-metrics \
    > "$log_file" 2>&1 &

  local pid=$!
  log_info "$name 已启动 (PID=$pid), 日志: $log_file"

  log_info "等待 $name 就绪 (SGLang 默认端口 $port) ..."
  for i in $(seq 1 180); do
    if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
      green "  ✓ $name 就绪 (port $port, 耗时 $((i*2))s)"
      return 0
    fi
    sleep 2
  done
  red "  ✗ $name 启动超时 (6分钟), 检查日志: $log_file"
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

# ─── 设置 MADS 网关环境变量 ───
export MADS_MODEL_REGISTRY_PATH="$REGISTRY_PATH"
export MADS_GATEWAY_PORT="$GATEWAY_PORT"
export MADS_MODEL_REGISTRY_TTL_SECONDS="60"
export MADS_SGLANG_LORA_MODEL_FORMAT="adapter_only"
export MADS_DISABLE_CLIENT_CACHE="false"
export MADS_AGENT_RUN_TIMEOUT_SECONDS="120"
export MADS_MBTI_LORA_MAP='{"ISTJ":"ISTJ","ISFJ":"ISFJ","INFJ":"INFJ","INTJ":"INTJ","ISTP":"ISTP","ISFP":"ISFP","INFP":"INFP","INTP":"INTP","ESTP":"ESTP","ESFP":"ESFP","ENFP":"ENFP","ENTP":"ENTP","ESTJ":"ESTJ","ESFJ":"ESFJ","ENFJ":"ENFJ","ENTJ":"ENTJ"}'
export MADS_ROUTER_STRATEGY=consensus
echo $MADS_MODEL_REGISTRY_PATH
# ─── 动态生成 model registry ───
# 注册表格式: 每个 (base_model, mbti) 组合一条记录
# Gateway 会通过 _route_runtime_model() 将请求转成 "base:adapter" 格式

generate_registry() {
  local base_model="$1" endpoint="$2" priority="$3"
  local prefix="${base_model}-"
  echo '{'
  echo '  "default_model_id": "'"${prefix}ISFJ"'",'
  echo '  "models": ['
  local first=true
  for mbti in "${MBTI_TYPES[@]}"; do
    $first || echo ','
    first=false
    printf '    {"model_id":"%s","display_name":"%s-%s","endpoint":"%s/v1","api_key":"EMPTY","base_model":"%s","lora_name":"%s","model":"%s","priority":%d,"tags":["%s","%s"]}' \
      "${prefix}${mbti,,}" "$base_model" "$mbti" "$endpoint" "$base_model" "$mbti" "$base_model" "$priority" "$base_model" "$mbti"
  done
  echo ''
  echo '  ]'
  echo '}'
}

GATEWAY_REGISTRY_JSON=$(generate_registry "llama3.1" "http://127.0.0.1:8001" 80)

# 如果有 qwen3, 追加到同一注册表
if [[ -d "$QWEN3_BASE" ]]; then
  GATEWAY_REGISTRY_JSON="$GATEWAY_REGISTRY_JSON"$'\n'"$(generate_registry "qwen3" "http://127.0.0.1:8002" 70)"
fi

export MADS_MODEL_REGISTRY_JSON

# ─── 启动 SGLang 服务 ───
#start_sglang "llama3.1" "$LLAMA3_PORT" "$LLAMA3_BASE" "0,1,2,3" "$LLAMA3_LORA_DIR" "$LOG_DIR/sglang_llama3.log"

if [[ -d "$QWEN3_BASE" ]]; then
  start_sglang "qwen3" "$QWEN3_PORT" "$QWEN3_BASE" "0,1,2,3,4,5,6,7" "$QWEN3_LORA_DIR" "$LOG_DIR/sglang_qwen3.log"
fi

# ─── 启动 MADS 网关 ───
echo ""
cyan "========================================"
cyan "  启动 MADS Gateway (port $GATEWAY_PORT)"
cyan "  LoRA 格式: base_model:adapter_name"
cyan "========================================"

cd "$PROJECT_ROOT"
exec "$PYTHON_BIN" ./autogen_gateway.py
