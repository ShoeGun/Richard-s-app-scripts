$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\qwen-worker.mjs") --doctor

