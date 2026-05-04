#!/usr/bin/env bash
set -euo pipefail

# Port mapping:
# 8100 -> family_general_v1
# 8101 -> father_strict_v1
# 8102 -> mother_warm_v1
# 8103 -> child_rebel_v1
# 8110 -> school_general_v1
# 9001 -> autogen_gateway

PROJECT_ROOT="${PROJECT_ROOT:-/opt/mads}"
REGISTRY_PATH="${REGISTRY_PATH:-$PROJECT_ROOT/deploy/model_registry.example.json}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
LLAMAFACTORY_CMD="${LLAMAFACTORY_CMD:-llamafactory-cli}"
GATEWAY_PORT="${GATEWAY_PORT:-9001}"
LOG_DIR="$PROJECT_ROOT/deploy/logs"
mkdir -p "$LOG_DIR"

start_api() {
  local model_id="$1"
  local base_path="$2"
  local adapter_path="$3"
  local port="$4"
  nohup "$LLAMAFACTORY_CMD" api \
    --host 0.0.0.0 \
    --port "$port" \
    --model_name_or_path "$base_path" \
    --adapter_name_or_path "$adapter_path" \
    > "$LOG_DIR/${model_id}.log" 2>&1 &
  echo "[$model_id] started on port $port"
}

echo "Starting LlamaFactory API services..."
start_api "family_general_v1" "/data/models/llama3" "/data/adapters/family_general_v1" "8100"
start_api "father_strict_v1"  "/data/models/llama3" "/data/adapters/father_strict_v1"  "8101"
start_api "mother_warm_v1"    "/data/models/qwen"   "/data/adapters/mother_warm_v1"    "8102"
start_api "child_rebel_v1"    "/data/models/deepseek" "/data/adapters/child_rebel_v1"  "8103"
start_api "school_general_v1" "/data/models/llama3" "/data/adapters/school_general_v1" "8110"

echo "Starting autogen gateway..."
export MADS_MODEL_REGISTRY_PATH="$REGISTRY_PATH"
export MADS_MODEL_REGISTRY_TTL_SECONDS="30"
export MADS_DISABLE_CLIENT_CACHE="false"
export MADS_PERSONA_MODEL_MAP='{"preset-father-strict":"father_strict_v1","preset-mother-warm":"mother_warm_v1","preset-child-rebel":"child_rebel_v1"}'
export MADS_GATEWAY_PORT="$GATEWAY_PORT"

cd "$PROJECT_ROOT"
exec "$PYTHON_BIN" ./autogen_gateway.py
