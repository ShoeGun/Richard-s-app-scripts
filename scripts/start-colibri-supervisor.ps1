[CmdletBinding()]
param(
  [string]$ModelDir,
  [int]$Port = 1236,
  [int]$RamGb = 40
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$labRoot = Split-Path $repoRoot -Parent
$ModelDir = if ($ModelDir) { $ModelDir } else { Join-Path $labRoot '.agent-lab-models\glm52-colibri-int4' }
$colibriDir = Join-Path $labRoot '.agent-lab-downloads\colibri\c'
$python = if ($env:COLIBRI_PYTHON) { $env:COLIBRI_PYTHON } else { 'C:\Python310\python.exe' }
$logDir = 'C:\tmp'
$stdout = Join-Path $logDir 'glm52-colibri.stdout.log'
$stderr = Join-Path $logDir 'glm52-colibri.stderr.log'

if (-not (Test-Path $python)) { throw "Python runtime not found: $python. Set COLIBRI_PYTHON to a Python 3.10+ executable." }
if (-not (Test-Path (Join-Path $colibriDir 'coli'))) { throw "Colibri launcher not found: $colibriDir\coli" }
if (-not (Test-Path (Join-Path $ModelDir 'config.json'))) { throw "GLM-5.2 model config not found: $ModelDir\config.json" }

$probe = New-Object System.Net.Sockets.TcpClient
try {
  $probe.Connect('127.0.0.1', $Port)
  Write-Output "Colibri is already listening on http://127.0.0.1:$Port/v1."
  exit 0
} catch {
  # No listener yet; start the service below.
} finally {
  $probe.Dispose()
}

$process = Start-Process -WindowStyle Hidden -FilePath $python -WorkingDirectory $colibriDir `
  -ArgumentList @('coli', 'serve', '--model', $ModelDir, '--auto-tier', '--gpu', 'none', '--ram', $RamGb, '--host', '127.0.0.1', '--port', $Port, '--model-id', 'glm-5.2-colibri', '--max-queue', '2', '--queue-timeout', '300') `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$deadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Seconds 2
  $probe = New-Object System.Net.Sockets.TcpClient
  try {
    $probe.Connect('127.0.0.1', $Port)
    Write-Output "Started GLM-5.2 Colibri on http://127.0.0.1:$Port/v1 (PID $($process.Id))."
    Write-Output "Logs: $stderr"
    exit 0
  } catch {
    # Keep waiting while the model process initializes.
  } finally {
    $probe.Dispose()
  }
} while ((Get-Date) -lt $deadline)

$tail = Get-Content $stderr -Tail 30 -ErrorAction SilentlyContinue
throw "Colibri did not open port $Port. Recent stderr:`n$($tail -join [Environment]::NewLine)"
