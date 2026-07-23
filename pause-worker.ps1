$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path (Join-Path $Root ".worker-control") | Out-Null
Set-Content -LiteralPath (Join-Path $Root ".worker-control\paused") -Value "paused $(Get-Date -Format o)" -Encoding UTF8
node (Join-Path $Root "worker\qwen-worker.mjs") --pause
Write-Host "Pause requested."

