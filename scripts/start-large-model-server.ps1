[CmdletBinding()]
param(
    [string]$ModelRoot = $env:LARGE_MODEL_ROOT,
    [string]$LlamaServer = $env:LLAMA_SERVER_PATH,
    [int]$Port = 1235
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ModelRoot)) {
    throw 'Set LARGE_MODEL_ROOT to the removable-drive model directory first.'
}
if (-not (Test-Path -LiteralPath $ModelRoot)) { throw "Model root does not exist: $ModelRoot" }
if ([string]::IsNullOrWhiteSpace($LlamaServer) -or -not (Test-Path -LiteralPath $LlamaServer)) {
    throw 'Set LLAMA_SERVER_PATH to the llama.cpp CUDA llama-server executable first.'
}

$model = Get-ChildItem -LiteralPath $ModelRoot -Filter '*.gguf' -File | Where-Object Name -like '*Kimi-K2.5*' | Select-Object -First 1
if (-not $model) { throw "No Kimi-K2.5 GGUF was found under $ModelRoot" }

Write-Host "Starting opt-in mmap server with $($model.Name)"
& $LlamaServer `
    --model $model.FullName `
    --host 127.0.0.1 `
    --port $Port `
    --ctx-size 4096 `
    --n-gpu-layers 8 `
    --mmap `
    --no-mlock
