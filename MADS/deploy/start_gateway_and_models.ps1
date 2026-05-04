#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

param(
  [string]$PythonExe = "python",
  [string]$LlamaFactoryCmd = "llamafactory-cli",
  [string]$ProjectRoot = "F:\Pycharmproject\MADS",
  [string]$RegistryPath = "F:\Pycharmproject\MADS\deploy\model_registry.example.json",
  [string]$GatewayPort = "9001"
)

# Port mapping:
# 8100 -> family_general_v1
# 8101 -> father_strict_v1
# 8102 -> mother_warm_v1
# 8103 -> child_rebel_v1
# 8110 -> school_general_v1
# 9001 -> autogen_gateway

$logsDir = Join-Path $ProjectRoot "deploy\logs"
if (-not (Test-Path $logsDir)) {
  New-Item -ItemType Directory -Path $logsDir | Out-Null
}

$modelPorts = @(
  @{ model = "family_general_v1"; base = "C:\models\llama3"; adapter = "C:\models\adapters\family_general_v1"; port = "8100" },
  @{ model = "father_strict_v1"; base = "C:\models\llama3"; adapter = "C:\models\adapters\father_strict_v1"; port = "8101" },
  @{ model = "mother_warm_v1"; base = "C:\models\qwen";   adapter = "C:\models\adapters\mother_warm_v1";   port = "8102" },
  @{ model = "child_rebel_v1"; base = "C:\models\deepseek"; adapter = "C:\models\adapters\child_rebel_v1"; port = "8103" },
  @{ model = "school_general_v1"; base = "C:\models\llama3"; adapter = "C:\models\adapters\school_general_v1"; port = "8110" }
)

Write-Host "Starting LlamaFactory API services..."
foreach ($item in $modelPorts) {
  $logPath = Join-Path $logsDir "$($item.model).log"
  $args = @(
    "api",
    "--host", "0.0.0.0",
    "--port", $item.port,
    "--model_name_or_path", $item.base,
    "--adapter_name_or_path", $item.adapter
  )
  Start-Process -FilePath $LlamaFactoryCmd -ArgumentList $args -RedirectStandardOutput $logPath -RedirectStandardError $logPath -WindowStyle Hidden
  Write-Host ("  [{0}] on port {1}" -f $item.model, $item.port)
}

Write-Host "Configuring gateway env..."
$env:MADS_MODEL_REGISTRY_PATH = $RegistryPath
$env:MADS_MODEL_REGISTRY_TTL_SECONDS = "30"
$env:MADS_DISABLE_CLIENT_CACHE = "false"
$env:MADS_PERSONA_MODEL_MAP = '{"preset-father-strict":"father_strict_v1","preset-mother-warm":"mother_warm_v1","preset-child-rebel":"child_rebel_v1"}'
$env:MADS_GATEWAY_PORT = $GatewayPort

Write-Host ("Starting autogen gateway on port {0} ..." -f $GatewayPort)
Push-Location $ProjectRoot
try {
  & $PythonExe ".\autogen_gateway.py"
} finally {
  Pop-Location
}
