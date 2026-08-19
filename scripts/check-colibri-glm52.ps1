[CmdletBinding()]
param([string]$ModelRoot)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$labRoot = Split-Path $repoRoot -Parent
$ModelRoot = if ($ModelRoot) { $ModelRoot } else { Join-Path $labRoot '.agent-lab-models\glm52-colibri-int4' }
$colibriDir = Join-Path $labRoot '.agent-lab-downloads\colibri\c'
$python = if ($env:COLIBRI_PYTHON) { $env:COLIBRI_PYTHON } else { 'C:\Python310\python.exe' }
$coli = Join-Path $colibriDir 'coli'

if (-not (Test-Path -LiteralPath $python)) { throw "Python runtime not found: $python" }
if (-not (Test-Path -LiteralPath $coli)) { throw "Colibri launcher was not found at $coli" }
if (-not (Test-Path -LiteralPath (Join-Path $ModelRoot 'config.json'))) { throw "GLM-5.2 model config.json is missing: $ModelRoot" }

& $python $coli doctor --model $ModelRoot --deep
