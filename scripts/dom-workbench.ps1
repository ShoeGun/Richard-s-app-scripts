[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('validate', 'prepare', 'plan', 'train', 'evaluate', 'package', 'smoke')]
  [string]$Command = 'validate',
  [string]$RunId,
  [ValidateSet('desktop-gpu', 'desktop-cpu', 'mobile')]
  [string]$Target,
  [string]$Endpoint,
  [int]$TimeoutSeconds,
  [string]$BaseModel,
  [string]$Skill
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$gpuTrainingPython = Join-Path $env:USERPROFILE 'Projects\DomWorkbenchGpuVenv\Scripts\python.exe'
$cpuTrainingPython = Join-Path $env:USERPROFILE 'Projects\DomWorkbenchVenv\Scripts\python.exe'
$python = if ($env:DOM_TRAINING_PYTHON) { $env:DOM_TRAINING_PYTHON } elseif (Test-Path $gpuTrainingPython) { $gpuTrainingPython } elseif (Test-Path $cpuTrainingPython) { $cpuTrainingPython } elseif (Test-Path 'C:\ai\airllm-venv\Scripts\python.exe') { 'C:\ai\airllm-venv\Scripts\python.exe' } else { 'python' }
$script = Join-Path $PSScriptRoot 'dom_workbench.py'
$args = @($script, $Command)
if ($RunId) { $args += @('--run-id', $RunId) }
if ($Target) { $args += @('--target', $Target) }
if ($Endpoint) { $args += @('--endpoint', $Endpoint) }
if ($TimeoutSeconds) { $args += @('--timeout-seconds', $TimeoutSeconds) }
if ($BaseModel) { $args += @('--base-model', $BaseModel) }
if ($Skill) { $args += @('--skill', $Skill) }
Write-Host "Dom workbench: $Command using $python" -ForegroundColor Cyan
& $python @args
if ($LASTEXITCODE -ne 0) { throw "Dom workbench command failed with exit code $LASTEXITCODE" }
