[CmdletBinding()]
param(
  [string]$ModelRoot,
  [int]$Port = 1236,
  [int]$RamGb = 40
)

$ErrorActionPreference = 'Stop'
$supervisor = Join-Path $PSScriptRoot 'start-colibri-supervisor.ps1'
if (-not (Test-Path -LiteralPath $supervisor)) {
  throw "Colibri supervisor wrapper was not found: $supervisor"
}

$args = @{ Port = $Port; RamGb = $RamGb }
if ($ModelRoot) { $args.ModelDir = $ModelRoot }
& $supervisor @args
