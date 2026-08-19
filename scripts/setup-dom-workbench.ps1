[CmdletBinding()]
param(
  [string]$VenvPath = "$env:USERPROFILE\Projects\DomWorkbenchVenv",
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$python = if (Test-Path 'C:\Python310\python.exe') { 'C:\Python310\python.exe' } else { 'python' }
$venvPython = Join-Path $VenvPath 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Host "Creating isolated Dom training environment at $VenvPath" -ForegroundColor Cyan
  & $python -m venv $VenvPath
}

if ($Install) {
  & $venvPython -m pip install --upgrade pip
  & $venvPython -m pip install -r (Join-Path $repoRoot 'training\requirements-training.txt')
  if ($LASTEXITCODE -ne 0) { throw "Dom training dependency installation failed with exit code $LASTEXITCODE" }
} else {
  Write-Host 'Environment created or already present. Re-run with -Install to download optional training dependencies.' -ForegroundColor DarkCyan
}

Write-Host "Use this environment with: `$env:DOM_TRAINING_PYTHON='$venvPython'" -ForegroundColor Green
