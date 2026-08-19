[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Prompt,
  [int]$MaxTokens = 256,
  [int]$Port = 1236,
  [int]$TimeoutSeconds = 7200,
  [switch]$Interactive
)

$ErrorActionPreference = 'Stop'

if ($Interactive) {
  $messages = [System.Collections.Generic.List[object]]::new()
  $messages.Add(@{ role = 'system'; content = 'You are GLM-5.2 Colibri running locally for Richard. Be concise, concrete, and honest about uncertainty. This is a slow disk-streamed session, so prefer useful complete answers over long exposition.' })
  Write-Host 'GLM-5.2 Colibri interactive chat. Type /exit to quit.' -ForegroundColor Cyan
  while ($true) {
    $inputText = Read-Host 'You'
    if ($inputText -eq '/exit') { break }
    if ([string]::IsNullOrWhiteSpace($inputText)) { continue }
    $messages.Add(@{ role = 'user'; content = $inputText })
    $body = @{
      model = 'glm-5.2-colibri'
      messages = @($messages)
      max_tokens = $MaxTokens
      temperature = 0
      stream = $false
    } | ConvertTo-Json -Depth 8 -Compress
    Write-Host 'GLM is thinking locally; disk-streamed inference may take a while...' -ForegroundColor DarkCyan
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/v1/chat/completions" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec $TimeoutSeconds
    $answer = $response.choices[0].message.content
    if ([string]::IsNullOrWhiteSpace($answer)) { $answer = '[GLM returned no text]' }
    Write-Host "`nGLM`n$answer`n" -ForegroundColor White
    $messages.Add(@{ role = 'assistant'; content = $answer })
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Prompt)) {
  throw 'Provide a prompt or use -Interactive for a multi-turn chat.'
}

$payload = @{
  model = 'glm-5.2-colibri'
  messages = @(@{ role = 'user'; content = $Prompt })
  max_tokens = $MaxTokens
  temperature = 0
  stream = $true
} | ConvertTo-Json -Depth 6 -Compress

Write-Host "Sending to GLM-5.2 Colibri. Disk-streamed inference may take a while before the first token..." -ForegroundColor Cyan
$payloadFile = Join-Path $env:TEMP "colibri-chat-$([guid]::NewGuid().ToString('N')).json"
try {
  [System.IO.File]::WriteAllText($payloadFile, $payload, [System.Text.UTF8Encoding]::new($false))
  & curl.exe -sS -N `
    -H 'Content-Type: application/json' `
    -H 'Accept: text/event-stream' `
    --max-time $TimeoutSeconds `
    --data-binary "@$payloadFile" `
    "http://127.0.0.1:$Port/v1/chat/completions"
} finally {
  Remove-Item -LiteralPath $payloadFile -Force -ErrorAction SilentlyContinue
}
