$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path (Join-Path $Root ".worker-control") | Out-Null
Set-Content -LiteralPath (Join-Path $Root ".worker-control\stop") -Value "stop $(Get-Date -Format o)" -Encoding UTF8
node (Join-Path $Root "worker\qwen-worker.mjs") --stop
Write-Host "Stop requested. The scheduled task remains registered for next login/start."

