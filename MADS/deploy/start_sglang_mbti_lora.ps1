# ============================================================
# SGLang Dynamic LoRA 启动脚本 — Windows PowerShell
# 远程通过 SSH 执行或直接在 Windows 服务器上启动
# 架构: GPU 0-3 → llama3.1 (:8001), GPU 4-7 → qwen3 (:8002)
# ============================================================

$ErrorActionPreference = "Stop"

$ProjectRoot = if ($env:PROJECT_ROOT) { $env:PROJECT_ROOT } else { Split-Path -Parent $PSScriptRoot }

$ModelDir     = if ($env:MODEL_DIR)     { $env:MODEL_DIR     } else { "D:\data\models" }
$Llama3Base   = if ($env:LLAMA3_BASE)   { $env:LLAMA3_BASE   } else { "$ModelDir\llama3.1-8b-instruct" }
$Qwen3Base    = if ($env:QWEN3_BASE)    { $env:QWEN3_BASE    } else { "$ModelDir\qwen3-8b-instruct" }
$Llama3LoraDir = if ($env:LLAMA3_LORA_DIR) { $env:LLAMA3_LORA_DIR } else { "$ModelDir\loras\llama3.1-8b-mbti" }
$Qwen3LoraDir  = if ($env:QWEN3_LORA_DIR)  { $env:QWEN3_LORA_DIR  } else { "$ModelDir\loras\qwen3-8b-mbti" }

$Llama3Port   = if ($env:LLAMA3_PORT)   { $env:LLAMA3_PORT   } else { 8001 }
$Qwen3Port    = if ($env:QWEN3_PORT)    { $env:QWEN3_PORT    } else { 8002 }
$GatewayPort  = if ($env:GATEWAY_PORT)  { $env:GATEWAY_PORT  } else { 9001 }

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

# 生成 LoRA config JSON
function New-LoraConfig {
  param($LoraDir, $OutJson)
  $obj = @{}
  foreach ($mbti in $MBTI_TYPES) {
    $path = Join-Path $LoraDir $mbti
    if (Test-Path $path) {
      $obj[$mbti] = $path.Replace('\', '/')
    } else {
      Write-Warning "LoRA adapter 不存在: $path"
    }
  }
  $obj | ConvertTo-Json -Depth 1 | Out-File -FilePath $OutJson -Encoding UTF8
  Write-Host "[INFO] 生成 lora config: $OutJson" -ForegroundColor Green
}

$Llama3LoraJson = Join-Path $LogDir "llama3_lora_config.json"
$Qwen3LoraJson  = Join-Path $LogDir "qwen3_lora_config.json"
New-LoraConfig -LoraDir $Llama3LoraDir -OutJson $Llama3LoraJson
New-LoraConfig -LoraDir $Qwen3LoraDir  -OutJson $Qwen3LoraJson

# 设置 MADS 网关环境变量
$env:MADS_MODEL_REGISTRY_JSON = @'
{
  "default_model_id":"llama3-isfj",
  "models":[...]
}
'@  # 完整注册表同 sh 版本, 可通过文件加载

$env:MADS_MODEL_REGISTRY_TTL_SECONDS = "60"
$env:MADS_MBTI_LORA_MAP = '{"ISTJ":"ISTJ","ISFJ":"ISFJ","INFJ":"INFJ","INTJ":"INTJ","ISTP":"ISTP","ISFP":"ISFP","INFP":"INFP","INTP":"INTP","ESTP":"ESTP","ESFP":"ESFP","ENFP":"ENFP","ENTP":"ENTP","ESTJ":"ESTJ","ESFJ":"ESFJ","ENFJ":"ENFJ","ENTJ":"ENTJ"}'
$env:MADS_GATEWAY_PORT = "$GatewayPort"
$env:MADS_DISABLE_CLIENT_CACHE = "false"

# 启动 llama3.1 SGLang
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动 SGLang: llama3.1 (port $Llama3Port, GPU 0-3)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$env:CUDA_VISIBLE_DEVICES = "0,1,2,3"
Start-Process -NoNewWindow -FilePath "python3" -ArgumentList @(
  "-m","sglang.launch_server",
  "--host","0.0.0.0",
  "--port","$Llama3Port",
  "--model-path","$Llama3Base",
  "--served-model-name","llama3.1",
  "--enable-lora",
  "--lora-paths","$Llama3LoraJson",
  "--max-loras-per-request","1",
  "--max-lora-rank","64",
  "--max-running-requests","32",
  "--tp-size","4",
  "--mem-fraction-static","0.85",
  "--log-level","info",
  "--log-requests",
  "--show-time-cost",
  "--enable-metrics"
) -RedirectStandardOutput "$LogDir\sglang_llama3.log" -RedirectStandardError "$LogDir\sglang_llama3.err"

Write-Host "[INFO] llama3.1 已启动, 日志: $LogDir\sglang_llama3.log" -ForegroundColor Green

# 启动 qwen3 SGLang
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动 SGLang: qwen3 (port $Qwen3Port, GPU 4-7)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$env:CUDA_VISIBLE_DEVICES = "4,5,6,7"
Start-Process -NoNewWindow -FilePath "python3" -ArgumentList @(
  "-m","sglang.launch_server",
  "--host","0.0.0.0",
  "--port","$Qwen3Port",
  "--model-path","$Qwen3Base",
  "--served-model-name","qwen3",
  "--enable-lora",
  "--lora-paths","$Qwen3LoraJson",
  "--max-loras-per-request","1",
  "--max-lora-rank","64",
  "--max-running-requests","32",
  "--tp-size","4",
  "--mem-fraction-static","0.85",
  "--log-level","info",
  "--log-requests",
  "--show-time-cost",
  "--enable-metrics"
) -RedirectStandardOutput "$LogDir\sglang_qwen3.log" -RedirectStandardError "$LogDir\sglang_qwen3.err"

Write-Host "[INFO] qwen3 已启动, 日志: $LogDir\sglang_qwen3.log" -ForegroundColor Green

# 启动 MADS 网关
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动 MADS Gateway (port $GatewayPort)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Set-Location $ProjectRoot
python3 ./autogen_gateway.py
