param(
  [Parameter(Mandatory = $true)]
  [string]$Id,

  [Parameter(Mandatory = $true)]
  [string]$Model,

  [int]$ContextTokens = 16384,

  [double]$Temperature = 0.1,

  [switch]$Enabled
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root "worker\config.json"
$Config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json

if (-not $Config.escalation) {
  $Config | Add-Member -NotePropertyName escalation -NotePropertyValue ([pscustomobject]@{ enabled = $true; localChannels = @() })
}
if (-not $Config.escalation.localChannels) {
  $Config.escalation | Add-Member -NotePropertyName localChannels -NotePropertyValue @()
}

$Existing = @($Config.escalation.localChannels) | Where-Object { $_.id -eq $Id }
if ($Existing) {
  $Existing.model = $Model
  $Existing.contextTokens = $ContextTokens
  $Existing.temperature = $Temperature
  $Existing.enabled = [bool]$Enabled
} else {
  $Config.escalation.localChannels += [pscustomobject]@{
    id = $Id
    type = "ollama"
    model = $Model
    enabled = [bool]$Enabled
    autoInvoke = $false
    contextTokens = $ContextTokens
    temperature = $Temperature
  }
}

$Config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
Write-Host "Updated local escalation channel '$Id' -> $Model"

