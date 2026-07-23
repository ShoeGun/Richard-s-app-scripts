$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$TaskName = "EdgeOpsQwenWorker"
$Node = (Get-Command node.exe).Source

New-Item -ItemType Directory -Force -Path (Join-Path $Root ".worker-control") | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root ".worker-control\paused")
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $Root ".worker-control\stop")

$Action = New-ScheduledTaskAction -Execute $Node -Argument "worker/qwen-worker.mjs --loop" -WorkingDirectory $Root
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Started $TaskName."
Write-Host "Status: powershell -ExecutionPolicy Bypass -File `"$Root\worker-status.ps1`""
