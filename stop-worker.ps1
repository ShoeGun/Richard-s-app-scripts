$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path (Join-Path $Root ".worker-control") | Out-Null
Set-Content -LiteralPath (Join-Path $Root ".worker-control\stop") -Value "stop $(Get-Date -Format o)" -Encoding UTF8
node (Join-Path $Root "worker\qwen-worker.mjs") --stop
Stop-ScheduledTask -TaskName "EdgeOpsQwenWorker" -ErrorAction SilentlyContinue
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'worker[/\\]qwen-worker\.mjs\s+--loop'
}
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
}
Write-Host "Stop requested. The scheduled task remains registered for next login/start."
