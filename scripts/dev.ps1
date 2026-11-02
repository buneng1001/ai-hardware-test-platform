# 一键启动开发环境：自动挑空闲端口，避免多个项目同时开时撞车。
# 用法：
#   pwsh -File scripts/dev.ps1            # 从 8020 起找空闲端口
#   pwsh -File scripts/dev.ps1 -Port 8030 # 指定后端端口（被占用会直接报错退出）
# 后端和前端会各自在新窗口启动，脚本打印访问地址。

param(
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-PortFree([int]$candidate) {
  $connection = Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue
  return $null -eq $connection
}

# 指定端口被占用时明确报错，不偷偷换端口。
if ($Port -ne 0) {
  if (-not (Test-PortFree $Port)) {
    Write-Error "端口 $Port 已被占用，请换一个端口，或去掉 -Port 让脚本自动选。"
  }
} else {
  $Port = 8020
  while (-not (Test-PortFree $Port) -and $Port -lt 8100) {
    $Port++
  }
  if ($Port -ge 8100) {
    Write-Error "8020-8099 都被占用，请用 -Port 指定一个空闲端口。"
  }
}

# 前端也要避开已经开着的 5173，否则会悄悄换到 5174 而你还在看旧页面。
$uiPort = 5173
while (-not (Test-PortFree $uiPort) -and $uiPort -lt 5250) {
  $uiPort++
}

# 把代理目标写进前端本地环境文件（该文件不入库）。
$envFile = Join-Path $root "frontend/.env.development.local"
$envContent = "# 由 scripts/dev.ps1 自动生成：后端实际端口`nVITE_API_PROXY_TARGET=http://127.0.0.1:$Port`n"
[System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.UTF8Encoding]::new($false))

$python = Join-Path $root "backend/.venv/Scripts/python.exe"
if (-not (Test-Path $python)) {
  Write-Error "找不到 backend/.venv，请先按 README 创建虚拟环境。"
}

Write-Host "后端端口: $Port" -ForegroundColor Green
Write-Host "前端端口: $uiPort" -ForegroundColor Green
Write-Host "启动后端窗口…"

$backendCommand = "`$env:APP_DATA_DIR='data/acceptance'; & '$python' -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port $Port --env-file .env"
Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", $backendCommand -WorkingDirectory $root

Write-Host "启动前端窗口…"
$frontendCommand = "pnpm --dir frontend dev --host 127.0.0.1 --port $uiPort"
Start-Process -FilePath "powershell" -ArgumentList "-NoExit", "-Command", $frontendCommand -WorkingDirectory $root

Start-Sleep -Seconds 8
Write-Host "打开: http://127.0.0.1:$uiPort" -ForegroundColor Cyan
Write-Host "健康检查: http://127.0.0.1:$Port/api/health" -ForegroundColor Cyan
