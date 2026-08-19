[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$stateDir = Join-Path $env:LOCALAPPDATA "AgenticOS\comfyui"
$pidPath = Join-Path $stateDir "comfyui.pid"
if (-not (Test-Path -LiteralPath $pidPath)) {
  @{ status = "not-managed" } | ConvertTo-Json -Compress
  exit 0
}

$pid = [int](Get-Content -LiteralPath $pidPath -Raw).Trim()
$process = Get-Process -Id $pid -ErrorAction SilentlyContinue
if ($null -eq $process) {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  @{ status = "already-stopped"; pid = $pid } | ConvertTo-Json -Compress
  exit 0
}

Stop-Process -Id $pid
$process.WaitForExit(15000)
Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
@{ status = "stopped"; pid = $pid } | ConvertTo-Json -Compress
