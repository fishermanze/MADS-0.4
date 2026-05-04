#!/usr/bin/env bash
set -euo pipefail

# Port mapping:
# 8200 -> vLLM OpenAI API (dynamic LoRA)
# 9001 -> autogen_gateway

PROJECT_ROOT="${PROJECT_ROOT:-/opt/mads}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
VLLM_PORT="${VLLM_PORT:-8200}"
GATEWAY_PORT="${GATEWAY_PORT:-9001}"
BASE_MODEL_PATH="${BASE_MODEL_PATH:-/data/models/llama3-base}"
REGISTRY_PATH="${REGISTRY_PATH:-$PROJECT_ROOT/deploy/model_registry.example.json}"

echo "Starting vLLM dynamic LoRA on port ${VLLM_PORT} ..."
nohup "$PYTHON_BIN" -m vllm.entrypoints.openai.api_server \
  --host 0.0.0.0 \
  --port "$VLLM_PORT" \
  --model "$BASE_MODEL_PATH" \
  --served-model-name "llama3-base" \
  --enable-lora \
  --max-loras 16 \
  --max-lora-rank 64 \
  --gpu-memory-utilization 0.90 \
  --dtype auto \
  > "$PROJECT_ROOT/deploy/logs/vllm_dynamic_lora.log" 2>&1 &

echo "Starting autogen gateway on port ${GATEWAY_PORT} ..."
export MADS_MODEL_REGISTRY_PATH="$REGISTRY_PATH"
export MADS_MODEL_REGISTRY_TTL_SECONDS="30"
export MADS_DISABLE_CLIENT_CACHE="false"
export MADS_PERSONA_MODEL_MAP='{"preset-father-strict":"father_strict_v1","preset-mother-warm":"mother_warm_v1","preset-child-rebel":"child_rebel_v1"}'
export MADS_GATEWAY_PORT="$GATEWAY_PORT"

cd "$PROJECT_ROOT"
exec "$PYTHON_BIN" ./autogen_gateway.py
