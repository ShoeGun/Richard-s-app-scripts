param(
  [Parameter(Mandatory = $true)]
  [string]$TaskId,

  [string]$Answer,

  [string]$Channel,

  [switch]$FromClipboard
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Inbox = Join-Path $Root "ESCALATIONS\inbox"
New-Item -ItemType Directory -Force -Path $Inbox | Out-Null

if ($FromClipboard) {
  $Answer = Get-Clipboard -Raw
}

if ([string]::IsNullOrWhiteSpace($Answer)) {
  throw "Provide -Answer or -FromClipboard."
}

$Path = Join-Path $Inbox "$TaskId.md"
if ($Channel) {
  $Answer = "# Manual Escalation Answer: $TaskId`n`nChannel: $Channel`n`n$Answer"
}
Set-Content -LiteralPath $Path -Value $Answer -Encoding UTF8
Write-Host "Saved escalation answer: $Path"
