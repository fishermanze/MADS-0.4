# ============================================================
# SGLang Dynamic LoRA 启动脚本 — Windows PowerShell
# 架构: GPU 0-3 → llama3.1 (:8001), GPU 4-7 → qwen3 (:8002)
#
# LoRA 调用格式: model: "llama3.1:ISTJ"
# ============================================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else { Split-Path -Parent $ScriptDir }

$ModelDir       = if ($env:MODEL_DIR)       { $env:MODEL_DIR       } else { "D:\data\models" }
$Llama3Base     = if ($env:LLAMA3_BASE)     { $env:LLAMA3_BASE     } else { "$ModelDir\llama3.1-8b-instruct" }
$Qwen3Base      = if ($env:QWEN3_BASE)      { $env:QWEN3_BASE      } else { "$ModelDir\qwen3-8b-instruct" }
$Llama3LoraDir  = if ($env:LLAMA3_LORA_DIR) { $env:LLAMA3_LORA_DIR } else { "$ModelDir\loras\llama3.1-8b-mbti" }
$Qwen3LoraDir   = if ($env:QWEN3_LORA_DIR)  { $env:QWEN3_LORA_DIR  } else { "$ModelDir\loras\qwen3-8b-mbti" }

$Llama3Port  = if ($env:LLAMA3_PORT)  { $env:LLAMA3_PORT  } else { 8001 }
$Qwen3Port   = if ($env:QWEN3_PORT)   { $env:QWEN3_PORT   } else { 8002 }
$GatewayPort = if ($env:GATEWAY_PORT) { $env:GATEWAY_PORT } else { 9001 }

$LogDir = "$ProjectRoot\deploy\logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$MBTI_TYPES = @(
  "ISTJ","ISFJ","INFJ","INTJ",
  "ISTP","ISFP","INFP","INTP",
  "ESTP","ESFP","ENFP","ENTP",
  "ESTJ","ESFJ","ENFJ","ENTJ"
)

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║   MADS SGLang Dynamic LoRA 启动器        ║" -ForegroundColor Cyan
Write-Host "║   8×RTX 3090 — 2 base + 32 LoRA          ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "llama3 base:  $Llama3Base"
Write-Host "qwen3 base:   $Qwen3Base"
Write-Host "llama3 LoRA:  $Llama3LoraDir"
Write-Host "qwen3 LoRA:   $Qwen3LoraDir"
Write-Host "日志目录:     $LogDir"
Write-Host ""

# 构建 --lora-paths 参数 (NAME=PATH 格式)
function Build-LoraArgs {
  param($LoraDir)
  $args = @()
  foreach ($mbti in $MBTI_TYPES) {
    $path = Join-Path $LoraDir $mbti
    if (Test-Path $path) {
      $args += "$mbti=$path"
    } else {
      Write-Warning "LoRA adapter 不存在: $path"
    }
  }
  if ($args.Count -eq 0) {
    Write-Error "未找到任何 LoRA adapter 在 $LoraDir"
    exit 1
  }
  return $args
}

# 设置 MADS 网关环境变量
$env:MADS_GATEWAY_PORT = "$GatewayPort"
$env:MADS_SGLANG_LORA_MODEL_FORMAT = "base_colon_adapter"
$env:MADS_MODEL_REGISTRY_TTL_SECONDS = "60"
$env:MADS_DISABLE_CLIENT_CACHE = "false"
$env:MADS_AGENT_RUN_TIMEOUT_SECONDS = "120"
$env:MADS_MBTI_LORA_MAP = '{"ISTJ":"ISTJ","ISFJ":"ISFJ","INFJ":"INFJ","INTJ":"INTJ","ISTP":"ISTP","ISFP":"ISFP","INFP":"INFP","INTP":"INTP","ESTP":"ESTP","ESFP":"ESFP","ENFP":"ENFP","ENTP":"ENTP","ESTJ":"ESTJ","ESFJ":"ESFJ","ENFJ":"ENFJ","ENTJ":"ENTJ"}'

# ─── 启动 llama3.1 ───
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动 SGLang: llama3.1 (port $Llama3Port, GPU 0-3)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$Llama3LoraArgs = Build-LoraArgs -LoraDir $Llama3LoraDir

$env:CUDA_VISIBLE_DEVICES = "0,1,2,3"
$Llama3Process = Start-Process -NoNewWindow -PassThru -FilePath "python3" -ArgumentList @(
  "-m","sglang.launch_server",
  "--host","0.0.0.0",
  "--port","$Llama3Port",
  "--model-path","$Llama3Base",
  "--served-model-name","llama3.1",
  "--lora-paths"
) + $Llama3LoraArgs + @(
  "--max-loras-per-batch","4",
  "--max-lora-rank","64",
  "--tp-size","4",
  "--mem-fraction-static","0.85",
  "--log-requests",
  "--enable-metrics"
) -RedirectStandardOutput "$LogDir\sglang_llama3.log" -RedirectStandardError "$LogDir\sglang_llama3.err"

Write-Host "[INFO] llama3.1 已启动 (PID=$($Llama3Process.Id)), 日志: $LogDir\sglang_llama3.log" -ForegroundColor Green

# ─── 启动 qwen3 ───
if (Test-Path $Qwen3Base) {
  Write-Host ""
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host "  启动 SGLang: qwen3 (port $Qwen3Port, GPU 4-7)" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan

  $Qwen3LoraArgs = Build-LoraArgs -LoraDir $Qwen3LoraDir

  $env:CUDA_VISIBLE_DEVICES = "4,5,6,7"
  $Qwen3Process = Start-Process -NoNewWindow -PassThru -FilePath "python3" -ArgumentList @(
    "-m","sglang.launch_server",
    "--host","0.0.0.0",
    "--port","$Qwen3Port",
    "--model-path","$Qwen3Base",
    "--served-model-name","qwen3",
    "--lora-paths"
  ) + $Qwen3LoraArgs + @(
    "--max-loras-per-batch","4",
    "--max-lora-rank","64",
    "--tp-size","4",
    "--mem-fraction-static","0.85",
    "--log-requests",
    "--enable-metrics"
  ) -RedirectStandardOutput "$LogDir\sglang_qwen3.log" -RedirectStandardError "$LogDir\sglang_qwen3.err"

  Write-Host "[INFO] qwen3 已启动 (PID=$($Qwen3Process.Id)), 日志: $LogDir\sglang_qwen3.log" -ForegroundColor Green
}

# ─── 启动 MADS 网关 ───
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动 MADS Gateway (port $GatewayPort)" -ForegroundColor Cyan
Write-Host "  LoRA 格式: base_model:adapter_name" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location $ProjectRoot
python3 ./autogen_gateway.py
