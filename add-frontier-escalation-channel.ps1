param(
  [Parameter(Mandatory = $true)]
  [string]$Id,

  [Parameter(Mandatory = $true)]
  [string]$Model,

  [ValidateSet("low", "medium", "high", "xhigh", "max", "ultra")]
  [string]$ReasoningEffort = "low",

  [int]$TimeoutSeconds = 1800,

  [int]$MaxAnswerWords = 900,

  [switch]$Enabled,

  [switch]$AutoInvoke,

  [switch]$AddToLadder
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root "worker\config.json"
$Config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json

if (-not $Config.escalation) {
  $Config | Add-Member -NotePropertyName escalation -NotePropertyValue ([pscustomobject]@{ enabled = $true; frontierChannels = @(); localChannels = @(); ladder = @() })
}
if (-not $Config.escalation.frontierChannels) {
  $Config.escalation | Add-Member -NotePropertyName frontierChannels -NotePropertyValue @()
}

$Existing = @($Config.escalation.frontierChannels) | Where-Object { $_.id -eq $Id }
if ($Existing) {
  $Existing.model = $Model
  $Existing.reasoningEffort = $ReasoningEffort
  $Existing.timeoutSeconds = $TimeoutSeconds
  $Existing.maxAnswerWords = $MaxAnswerWords
  $Existing.enabled = [bool]$Enabled
  $Existing.autoInvoke = [bool]$AutoInvoke
} else {
  $Config.escalation.frontierChannels += [pscustomobject]@{
    id = $Id
    type = "codex"
    model = $Model
    label = "$Model frontier unblocker"
    enabled = [bool]$Enabled
    autoInvoke = [bool]$AutoInvoke
    reasoningEffort = $ReasoningEffort
    timeoutSeconds = $TimeoutSeconds
    sandbox = "read-only"
    maxAnswerWords = $MaxAnswerWords
    instructions = "Return concise unblock guidance only. Do not edit files directly."
  }
}

if ($AddToLadder) {
  if (-not $Config.escalation.ladder) {
    $Config.escalation | Add-Member -NotePropertyName ladder -NotePropertyValue @()
  }
  $Ladder = @($Config.escalation.ladder)
  if ($Ladder -notcontains $Id) {
    $Config.escalation.ladder = @($Ladder + $Id)
  }
}

$Config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
Write-Host "Updated frontier escalation channel '$Id' -> $Model"
