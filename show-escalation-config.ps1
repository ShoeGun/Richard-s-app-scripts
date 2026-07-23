param()

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root "worker\config.json"
$Config = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
$Escalation = $Config.escalation

$Channels = @()
foreach ($Channel in @($Escalation.frontierChannels)) {
  $Channels += [pscustomobject]@{
    id = $Channel.id
    type = $Channel.type
    model = $Channel.model
    enabled = $Channel.enabled
    autoInvoke = $Channel.autoInvoke
    reasoningEffort = $Channel.reasoningEffort
  }
}
foreach ($Channel in @($Escalation.localChannels)) {
  $Channels += [pscustomobject]@{
    id = $Channel.id
    type = $Channel.type
    model = $Channel.model
    enabled = $Channel.enabled
    autoInvoke = $Channel.autoInvoke
    reasoningEffort = $null
  }
}

[pscustomobject]@{
  enabled = $Escalation.enabled
  ladder = @($Escalation.ladder)
  channels = $Channels
} | ConvertTo-Json -Depth 20
