Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$CapabilityPath = Join-Path $env:LOCALAPPDATA "AgenticOS\edgeops-control.capability"
$SessionUrl = "http://127.0.0.1:3210/api/agentic-os/browser-sessions"

try {
  if (-not (Test-Path -LiteralPath $CapabilityPath -PathType Leaf)) { throw "EDGEOPS_CONTROL_CAPABILITY_MISSING" }
  $CapabilityFile = Get-Item -LiteralPath $CapabilityPath -Force
  if (($CapabilityFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $CapabilityFile.Length -gt 256) {
    throw "EDGEOPS_CONTROL_CAPABILITY_INVALID"
  }
  $Capability = ([IO.File]::ReadAllText($CapabilityPath)).Trim()
  if ($Capability -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw "EDGEOPS_CONTROL_CAPABILITY_INVALID" }
  $Session = Invoke-RestMethod -Uri $SessionUrl -Method Post -ContentType "application/json" `
    -Headers @{ "X-EdgeOps-Control-Capability" = $Capability } -Body "{}" -TimeoutSec 10
  $Capability = $null

  $DashboardUrl = [string] $Session.bootstrapUrl
  if ($DashboardUrl -cnotmatch '^http://127\.0\.0\.1:3210/\?bootstrap=[A-Za-z0-9_-]{43}$') {
    throw "EDGEOPS_BROWSER_BOOTSTRAP_RESPONSE_INVALID"
  }
  Start-Process -FilePath $DashboardUrl | Out-Null
  $DashboardUrl = $null
  [Console]::Out.WriteLine((@{
    version = 1
    type = "edgeops-dashboard-launch"
    status = "opened"
    bootstrapStatus = "ready"
  } | ConvertTo-Json -Compress))
  exit 0
}
catch {
  [Console]::Out.WriteLine((@{
    version = 1
    type = "edgeops-dashboard-launch"
    status = "failed"
    code = [string] $_.Exception.Message
  } | ConvertTo-Json -Compress))
  exit 1
}
