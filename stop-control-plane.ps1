$ErrorActionPreference = "Stop"
$TaskName = "EdgeOpsControlPlane"

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$processes = Get-CimInstance Win32_Process | Where-Object {
  $_.CommandLine -match 'worker[/\\]control-plane\.mjs'
}
foreach ($process in $processes) {
  Stop-Process -Id $process.ProcessId -Force
}

Write-Host "Stopped $TaskName."
