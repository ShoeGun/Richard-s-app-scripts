param(
  [Parameter(Mandatory = $true)]
  [string]$TaskId,

  [string]$Channel = "gpt-5.4"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\qwen-worker.mjs") --escalate $TaskId --channel $Channel
