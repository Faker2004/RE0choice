# RE0choice 云端织网 — 本地部署助手
# 用法: .\scripts\deploy-cloud.ps1 -GitHubUser "你的用户名" -RepoName "RE0choice"

param(
    [Parameter(Mandatory = $true)]
    [string]$GitHubUser,

    [Parameter(Mandatory = $false)]
    [string]$RepoName = "RE0choice",

    [Parameter(Mandatory = $false)]
    [ValidateSet("public", "private")]
    [string]$Visibility = "public"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "==> [1/5] 更新 cloud-data/data.json ..." -ForegroundColor Cyan
Set-Location "$Root\cloud-data"
python update_okx.py
Set-Location $Root

$RemoteUrl = "https://github.com/$GitHubUser/$RepoName.git"
$CdnUrl = "https://cdn.jsdelivr.net/gh/$GitHubUser/$RepoName@main/cloud-data/data.json"

Write-Host "==> [2/5] 写入 mobile/.env ..." -ForegroundColor Cyan
@"
VITE_CLOUD_DATA_URL=$CdnUrl
"@ | Set-Content -Path "$Root\mobile\.env" -Encoding UTF8

Write-Host "==> [3/5] 构建手机端 ..." -ForegroundColor Cyan
Set-Location "$Root\mobile"
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build 失败" }

Write-Host "==> [4/5] Git 提交 ..." -ForegroundColor Cyan
Set-Location $Root
if (-not (Test-Path ".git")) {
    git init -b main
}
git add .
git diff --staged --quiet
if ($LASTEXITCODE -ne 0) {
    git commit -m "chore: bootstrap RE0choice cloud kline snapshot"
}

$HasRemote = git remote get-url origin 2>$null
if (-not $HasRemote) {
    git remote add origin $RemoteUrl
    Write-Host "已添加 remote: $RemoteUrl" -ForegroundColor Green
}

Write-Host ""
Write-Host "==> [5/5] 请在浏览器完成 GitHub 建仓（若尚未创建）:" -ForegroundColor Yellow
Write-Host "  1. 打开 https://github.com/new"
Write-Host "  2. Repository name: $RepoName"
Write-Host "  3. Visibility: $Visibility （公开仓才能用 jsDelivr 免 Token）"
Write-Host "  4. 不要勾选 Add README / .gitignore（本地已有）"
Write-Host "  5. 创建后在本目录执行:"
Write-Host "     git push -u origin main" -ForegroundColor White
Write-Host ""
Write-Host "==> 推送成功后，在 GitHub 仓库设置:" -ForegroundColor Yellow
Write-Host "  Settings -> Actions -> General -> Workflow permissions -> Read and write"
Write-Host "  Actions -> OKX Cloud Kline Sync -> Run workflow（首次 bootstrap）"
Write-Host ""
Write-Host "CDN 地址（已写入 mobile/.env）:" -ForegroundColor Green
Write-Host "  $CdnUrl"
Write-Host ""
Write-Host "Android 同步: cd mobile; npx cap sync android" -ForegroundColor Cyan
