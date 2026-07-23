$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $Root "worker\loop-bridge.mjs") --once

