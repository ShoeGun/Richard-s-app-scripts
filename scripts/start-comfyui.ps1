[CmdletBinding()]
param(
  [string]$Root = $env:COMFYUI_ROOT,
  [switch]$WaitForGpu,
  [switch]$StopRegisteredGpuOwners,
  [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = "C:\Users\Richard\Documents\comfy\ComfyUI"
}
$Root = [IO.Path]::GetFullPath($Root)
$python = Join-Path $Root ".venv\Scripts\python.exe"
$stateDir = Join-Path $env:LOCALAPPDATA "AgenticOS\comfyui"
$pidPath = Join-Path $stateDir "comfyui.pid"
$stdoutPath = Join-Path $stateDir "comfyui.stdout.log"
$stderrPath = Join-Path $stateDir "comfyui.stderr.log"
$healthUrl = "http://127.0.0.1:8188/system_stats"

New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
if (-not (Test-Path -LiteralPath $python)) { throw "ComfyUI Python runtime not found: $python" }

function Test-ComfyHealth {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch { return $false }
}

if (Test-ComfyHealth) {
  @{ status = "already-running"; url = "http://127.0.0.1:8188" } | ConvertTo-Json -Compress
  exit 0
}

function Get-GpuOwners {
  Get-CimInstance Win32_Process | Where-Object {
    if (-not $_.CommandLine) { return $false }
    $managedProcess = $_.Name -match "(?i)^(voicebox-server|ollama|colibri)(?:\.exe)?$"
    $managedComfyProcess = $_.Name -match "(?i)^python(?:\.exe)?$" -and $_.CommandLine -match "(?i)(?:comfyui|main\.py)"
    $managedProcess -or $managedComfyProcess
  } | Select-Object ProcessId,Name,CommandLine
}

$deadline = (Get-Date).AddSeconds([Math]::Max(0, $TimeoutSeconds))
do {
  $owners = @(Get-GpuOwners)
  if ($owners.Count -eq 0) { break }
  if ($StopRegisteredGpuOwners) {
    $stopped = @()
    foreach ($owner in $owners) {
      Stop-Process -Id $owner.ProcessId -Force -ErrorAction SilentlyContinue
      $stopped += "$($owner.Name)#$($owner.ProcessId)"
    }
    Add-Content -LiteralPath $stdoutPath -Value "$(Get-Date -Format o) stopped registered GPU owners: $($stopped -join ', ')"
    $StopRegisteredGpuOwners = $false
    Start-Sleep -Seconds 3
    continue
  }
  if (-not $WaitForGpu) {
    $names = ($owners | ForEach-Object { "$($_.Name)#$($_.ProcessId)" }) -join ", "
    throw "GPU is owned by $names. ComfyUI will wait instead of competing; rerun with -WaitForGpu after confirming the work can yield."
  }
  if ((Get-Date) -ge $deadline) {
    @{
      status = "waiting"
      url = "http://127.0.0.1:8188"
      owners = @($owners | ForEach-Object { "$($_.Name)#$($_.ProcessId)" })
      retryAfterSeconds = 5
      detail = "ComfyUI is waiting for the registered GPU owners to yield."
    } | ConvertTo-Json -Compress
    exit 0
  }
  Start-Sleep -Seconds 5
} while ($true)

$process = Start-Process -FilePath $python -ArgumentList @(
  "main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch", "--lowvram", "--fast-disk"
) -WorkingDirectory $Root -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  if (Test-ComfyHealth) {
    @{ status = "running"; pid = $process.Id; url = "http://127.0.0.1:8188"; log = $stdoutPath } | ConvertTo-Json -Compress
    exit 0
  }
  if ($process.HasExited) {
    $tail = (Get-Content -LiteralPath $stderrPath -Tail 20 -ErrorAction SilentlyContinue) -join "`n"
    throw "ComfyUI exited before health became ready. $tail"
  }
  Start-Sleep -Seconds 3
}
throw "ComfyUI did not become healthy within 90 seconds. Logs: $stdoutPath and $stderrPath"
