$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\loop-bridge.mjs") --status
$Task = Get-ScheduledTask -TaskName "EdgeOpsLoopBridge" -ErrorAction SilentlyContinue
if ($Task) {
  $Info = Get-ScheduledTaskInfo -TaskName "EdgeOpsLoopBridge" -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "Scheduled task: $($Task.State)"
  if ($Info) {
    Write-Host "Last run: $($Info.LastRunTime)"
    Write-Host "Last result: $($Info.LastTaskResult)"
    Write-Host "Next run: $($Info.NextRunTime)"
  }
} else {
  Write-Host ""
  Write-Host "Scheduled task: not registered"
}

