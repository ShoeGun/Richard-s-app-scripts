[CmdletBinding()]
param(
  [int]$WindowsPort = 1236,
  [int]$MacPort = 1236
)

$ErrorActionPreference = 'Stop'
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$sshConfig = 'C:\Users\Richard\.ssh\config'
$stdout = 'C:\tmp\openclaw-colibri-tunnel.stdout.log'
$stderr = 'C:\tmp\openclaw-colibri-tunnel.stderr.log'
$stateDir = Join-Path $env:LOCALAPPDATA 'AgenticOS'
$pidFile = Join-Path $stateDir 'openclaw-colibri-tunnel.pid'
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
$probe = New-Object System.Net.Sockets.TcpClient
try {
  $probe.Connect('127.0.0.1', $WindowsPort)
} catch {
  throw "Windows GLM endpoint is not listening on port $WindowsPort. Start Colibri first."
} finally {
  $probe.Dispose()
}

if (Test-Path -LiteralPath $pidFile) {
  $existingPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Output "Colibri tunnel is already running (PID $existingPid)."
    Write-Output 'Verify the Mac side with: ssh openclaw-mac curl -fsS http://127.0.0.1:1236/v1/models'
    exit 0
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

$forwardMarker = '-R 127.0.0.1:{0}:127.0.0.1:{1}' -f $MacPort, $WindowsPort
$remoteModels = & $ssh -F $sshConfig -o BatchMode=yes -o ConnectTimeout=10 openclaw-mac "curl -fsS http://127.0.0.1:$MacPort/v1/models" 2>$null
if ($LASTEXITCODE -eq 0 -and $remoteModels -match 'glm-5\.2-colibri') {
  $matchingTunnel = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'ssh.exe' -and $_.CommandLine -like "*$forwardMarker*" -and $_.CommandLine -like '*openclaw-mac*' } |
    Select-Object -First 1)
  if ($matchingTunnel) {
    Set-Content -LiteralPath $pidFile -Value $matchingTunnel.ProcessId -NoNewline
    Write-Output "Existing reverse SSH tunnel verified (PID $($matchingTunnel.ProcessId)). OpenClaw can reach GLM-5.2 Colibri."
  } else {
    Write-Output 'Existing reverse SSH tunnel verified. OpenClaw can reach GLM-5.2 Colibri.'
  }
  exit 0
}

$sshArgs = @(
  '-F', $sshConfig, '-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
  '-R', "127.0.0.1:$MacPort`:127.0.0.1:$WindowsPort", 'openclaw-mac'
)
$pathValue = $env:Path
try {
  Remove-Item Env:Path -ErrorAction SilentlyContinue
  $process = Start-Process -WindowStyle Hidden -FilePath $ssh -ArgumentList ($sshArgs -join ' ') -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} finally {
  $env:Path = $pathValue
}
Start-Sleep -Seconds 3
Set-Content -LiteralPath $pidFile -Value $process.Id -NoNewline
try {
  $remoteModels = & $ssh -F $sshConfig -o BatchMode=yes -o ConnectTimeout=10 openclaw-mac "curl -fsS http://127.0.0.1:$MacPort/v1/models"
  if ($LASTEXITCODE -ne 0) { throw 'remote model probe failed' }
  if ($remoteModels -notmatch 'glm-5\.2-colibri') { throw 'remote endpoint did not report glm-5.2-colibri' }
  Write-Output "Started and verified reverse SSH tunnel PID $($process.Id). OpenClaw can reach GLM-5.2 Colibri."
} catch {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
  $tail = Get-Content $stderr -Tail 20 -ErrorAction SilentlyContinue
  throw "Reverse tunnel verification failed: $($_.Exception.Message)`n$($tail -join [Environment]::NewLine)"
}
