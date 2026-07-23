param(
  [Parameter(Mandatory = $true)]
  [string]$Ladder
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root "worker\config.json"
$Config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json

if (-not $Config.escalation) {
  $Config | Add-Member -NotePropertyName escalation -NotePropertyValue ([pscustomobject]@{ enabled = $true })
}

$Ids = @($Ladder -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$Known = @()
foreach ($Channel in @($Config.escalation.frontierChannels)) { $Known += $Channel.id }
foreach ($Channel in @($Config.escalation.localChannels)) { $Known += $Channel.id }

foreach ($Id in $Ids) {
  if ($Known -notcontains $Id) {
    throw "Unknown escalation channel '$Id'. Add it first or check show-escalation-config.ps1."
  }
}

$Config.escalation.ladder = @($Ids)
$Config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
Write-Host "Updated escalation ladder: $($Ids -join ' -> ')"
