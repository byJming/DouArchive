# DouArchive 一键打包脚本
# 用法: pwsh scripts/build-release.ps1

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backendDir = Join-Path $root "backend"
$distDir = Join-Path $backendDir "dist"

Write-Host "=== DouArchive 打包工具 ===" -ForegroundColor Cyan

# 检查 Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "错误: 未找到 Python，请先安装 Python 3.10+" -ForegroundColor Red
    exit 1
}

$pyVersion = python --version 2>&1
Write-Host "Python: $pyVersion" -ForegroundColor Green

# 安装依赖
Write-Host "`n安装依赖..." -ForegroundColor Yellow
pip install -r (Join-Path $backendDir "requirements.txt") -q

if ($LASTEXITCODE -ne 0) {
    Write-Host "依赖安装失败" -ForegroundColor Red
    exit 1
}
Write-Host "依赖安装完成" -ForegroundColor Green

# 打包
Write-Host "`n开始打包..." -ForegroundColor Yellow
Set-Location $backendDir
python build.py

if ($LASTEXITCODE -ne 0) {
    Write-Host "打包失败" -ForegroundColor Red
    exit 1
}

$exePath = Join-Path $distDir "DouArchive.exe"
if (Test-Path $exePath) {
    $size = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
    Write-Host "`n打包成功!" -ForegroundColor Green
    Write-Host "输出: $exePath ($size MB)" -ForegroundColor Cyan
} else {
    Write-Host "打包完成但未找到输出文件" -ForegroundColor Yellow
}
