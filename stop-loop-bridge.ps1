$ErrorActionPreference = "Continue"
Stop-ScheduledTask -TaskName "EdgeOpsLoopBridge" -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "node.exe" -and $_.CommandLine -like "*worker/loop-bridge.mjs --loop*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "Stopped EdgeOpsLoopBridge."

