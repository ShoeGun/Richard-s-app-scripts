$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root ".worker-control\paused")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root ".worker-control\stop")
node (Join-Path $Root "worker\qwen-worker.mjs") --resume
Start-ScheduledTask -TaskName "EdgeOpsQwenWorker" -ErrorAction SilentlyContinue
Write-Host "Resume requested."

