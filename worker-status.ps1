$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\qwen-worker.mjs") --status
$Task = Get-ScheduledTask -TaskName "EdgeOpsQwenWorker" -ErrorAction SilentlyContinue
if ($Task) {
  $Info = Get-ScheduledTaskInfo -TaskName "EdgeOpsQwenWorker" -ErrorAction SilentlyContinue
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

