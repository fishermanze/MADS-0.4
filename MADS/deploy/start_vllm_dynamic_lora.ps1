#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$PythonExe = "python",
  [string]$GatewayProjectRoot = "F:\Pycharmproject\MADS",
  [string]$GatewayPort = "9001",
  [string]$VllmPort = "8200",
  [string]$BaseModelPath = "C:\models\llama3-base",
  [string]$RegistryPath = "F:\Pycharmproject\MADS\deploy\model_registry.example.json"
)

# Port mapping:
# 8200 -> vLLM OpenAI API (dynamic LoRA)
# 9001 -> autogen_gateway

$env:MADS_MODEL_REGISTRY_PATH = $RegistryPath
$env:MADS_MODEL_REGISTRY_TTL_SECONDS = "30"
$env:MADS_DISABLE_CLIENT_CACHE = "false"
$env:MADS_PERSONA_MODEL_MAP = '{"preset-father-strict":"father_strict_v1","preset-mother-warm":"mother_warm_v1","preset-child-rebel":"child_rebel_v1"}'
$env:MADS_GATEWAY_PORT = $GatewayPort

Write-Host ("Starting vLLM on port {0} ..." -f $VllmPort)
Start-Process -FilePath $PythonExe -ArgumentList @(
  "-m", "vllm.entrypoints.openai.api_server",
  "--host", "0.0.0.0",
  "--port", $VllmPort,
  "--model", $BaseModelPath,
  "--served-model-name", "llama3-base",
  "--enable-lora",
  "--max-loras", "16",
  "--max-lora-rank", "64",
  "--gpu-memory-utilization", "0.90",
  "--dtype", "auto"
) -WindowStyle Hidden

Write-Host ("Starting autogen gateway on port {0} ..." -f $GatewayPort)
Push-Location $GatewayProjectRoot
try {
  & $PythonExe ".\autogen_gateway.py"
} finally {
  Pop-Location
}
