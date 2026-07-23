param(
  [Parameter(Mandatory = $true)]
  [string]$TaskId,

  [string]$Channel = "qwen-coder-local"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\qwen-worker.mjs") --escalate $TaskId --channel $Channel

