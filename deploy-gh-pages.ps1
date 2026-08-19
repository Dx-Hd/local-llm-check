# ============================================================
# 一键部署到 GitHub Pages
# 前置条件（一次性）：
#   1. winget install Git.Git
#   2. winget install GitHub.cli
#   3. gh auth login
# 然后右键「使用 PowerShell 运行」本脚本，或：
#   powershell -ExecutionPolicy Bypass -File deploy-gh-pages.ps1
# ============================================================
$ErrorActionPreference = 'Stop'
$site = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $site

function Check-Cmd($name, $installHint) {
  try { & $name --version *> $null } catch { Write-Host "✗ 缺少 $name ：$installHint"; exit 1 }
  Write-Host "✓ $name 可用"
}

Write-Host "===== 检查环境 ====="
Check-Cmd git "请运行: winget install Git.Git"
Check-Cmd gh  "请运行: winget install GitHub.cli"

try { gh auth status *> $null } catch { Write-Host "✗ 未登录 GitHub，请运行: gh auth login"; exit 1 }
Write-Host "✓ GitHub 已登录 ($(gh api user --jq '.login'))"

Write-Host "`n===== 初始化 git 仓库 ====="
if (-not (Test-Path "$site\.git")) {
  git init -b main
} else {
  git checkout main 2>$null
}

Write-Host "`n===== 提交站点文件 ====="
git add -A
git commit -m "deploy: local-llm-check 站点更新" 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "（无新变更，继续）" }

Write-Host "`n===== 创建/推送远程仓库 ====="
$remote = git remote get-url origin 2>$null
$repo = ''
if (-not $remote) {
  $repo = gh repo create local-llm-check --public --source . --push
  if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ 仓库创建失败（可能已存在同名仓库）。" -ForegroundColor Red
    Write-Host "  方案A：给仓库改个名字后重跑本脚本"
    Write-Host "  方案B：先手动创建仓库，然后执行: git remote add origin https://github.com/你的用户名/local-llm-check.git && git push -u origin main"
    exit 1
  }
} else {
  git push -u origin main
  $repo = $remote -replace '^https://github.com/', '' -replace '\.git$', ''
}
Write-Host "✓ 仓库: $repo"

Write-Host "`n===== 开启 GitHub Pages ====="
$created = gh api "repos/$repo/pages" -X POST -f "source[branch]=main" -f "source[path]=/" --jq '.html_url' 2>$null
if ($LASTEXITCODE -ne 0) {
  # 可能已开启过，直接读取地址
  $url = gh api "repos/$repo/pages" --jq '.html_url' 2>$null
  if ($url) { Write-Host "✓ Pages 已开启: $url" } else { Write-Host "✗ Pages 开启失败，请到仓库 Settings → Pages 手动开启（Branch: main, /root）" }
} else {
  Write-Host "✓ Pages 地址: $created"
}

Write-Host "`n===== 完成 ====="
Write-Host "首次部署后约 1 分钟生效。"
Write-Host "之后更新站点：重新运行本脚本即可。"
