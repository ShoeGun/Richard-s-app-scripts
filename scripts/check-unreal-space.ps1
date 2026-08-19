param(
  [string]$Drive = "C:\",
  [double]$MinimumFreeGB = 120
)

$resolved = [System.IO.Path]::GetPathRoot($Drive)
$driveInfo = [System.IO.DriveInfo]::GetDrives() | Where-Object { $_.Name -eq $resolved }
if (-not $driveInfo) {
  [pscustomobject]@{ drive = $resolved; ready = $false; reason = "Drive is not ready" } | ConvertTo-Json
  exit 2
}

$freeGB = [math]::Round($driveInfo.AvailableFreeSpace / 1GB, 1)
$totalGB = [math]::Round($driveInfo.TotalSize / 1GB, 1)
$launcher = "C:\Program Files (x86)\Epic Games\Launcher\Portal\Binaries\Win64\EpicGamesLauncher.exe"
[pscustomobject]@{
  drive = $resolved
  freeGB = $freeGB
  totalGB = $totalGB
  minimumFreeGB = $MinimumFreeGB
  ready = $freeGB -ge $MinimumFreeGB
  epicGamesLauncherInstalled = Test-Path -LiteralPath $launcher
  unrealEngineDetected = @(
    "C:\Program Files\Epic Games\UE_*\Engine\Binaries\Win64\UnrealEditor.exe",
    "C:\Program Files\Epic Games\UE_*\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
  ) | ForEach-Object { Get-ChildItem -Path $_ -ErrorAction SilentlyContinue } | Measure-Object | Select-Object -ExpandProperty Count
} | ConvertTo-Json

if ($freeGB -lt $MinimumFreeGB) { exit 1 }
