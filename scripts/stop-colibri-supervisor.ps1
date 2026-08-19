[CmdletBinding()]
param([int]$Port = 1236)

$ErrorActionPreference = 'Stop'
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if (-not $listeners) {
  Write-Output "No Colibri listener found on port $Port."
  exit 0
}

foreach ($listener in $listeners) {
  $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
  if ($process -and $process.Path -like '*python.exe') {
    Stop-Process -Id $process.Id -Force
    Write-Output "Stopped Colibri PID $($process.Id)."
  } else {
    Write-Output "Port $Port is owned by PID $($listener.OwningProcess); left it untouched."
  }
}
