param(
    [string] $RclonePath = "C:\Users\Richard\Projects\tools\rclone\rclone.exe",
    [string] $ConfigPath = "$env:LOCALAPPDATA\AgenticOS\nextcloud-rclone.conf",
    [string] $LogPath = "C:\tmp\zip-archive-transfer.log"
)

$ErrorActionPreference = "Stop"

$items = @(
    [pscustomobject]@{
        Source = "C:\Users\Richard\OneDrive\Desktop\Holly data\New folder.zip"
        Remote = "nextcloud:Images/Holly data/New folder.zip"
    },
    [pscustomobject]@{
        Source = "C:\Users\Richard\OneDrive\Pictures.zip"
        Remote = "nextcloud:Images/Pictures.zip"
    },
    [pscustomobject]@{
        Source = "C:\Users\Richard\Apple.zip"
        Remote = "nextcloud:Phone-Backup/Apple.zip"
    }
)

function Write-Log {
    param([string] $Message)
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -LiteralPath $LogPath -Value $line
    Write-Host $line
}

function Invoke-Rclone {
    param([string[]] $Arguments)
    & $RclonePath --config $ConfigPath @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
    if ($LASTEXITCODE -ne 0) {
        throw "rclone failed with exit code $LASTEXITCODE"
    }
}

function Get-RemoteBytes {
    param([string] $Remote)
    $raw = & $RclonePath --config $ConfigPath size $Remote --json 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect remote object: $Remote"
    }
    $summary = ($raw -join "`n") | ConvertFrom-Json
    return [int64] $summary.bytes
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LogPath) | Out-Null
Write-Log "Starting sequential ZIP archive transfer. Local files are deleted only after exact byte verification."

foreach ($item in $items) {
    try {
        if (!(Test-Path -LiteralPath $item.Source -PathType Leaf)) {
            Write-Log "SKIP missing: $($item.Source)"
            continue
        }

        $sourceInfo = Get-Item -LiteralPath $item.Source
        $stream = $null
        try {
            $stream = [IO.File]::Open($item.Source, "Open", "Read", "None")
        }
        catch {
            throw "Source is locked or still being written: $($item.Source)"
        }
        finally {
            if ($stream) { $stream.Dispose() }
        }

        $sourceBytes = [int64] $sourceInfo.Length
        Write-Log "COPY $($item.Source) ($sourceBytes bytes) -> $($item.Remote)"
        Invoke-Rclone @(
            "copyto", $item.Source, $item.Remote,
            "--size-only", "--transfers", "1", "--checkers", "2",
            "--webdav-nextcloud-chunk-size", "5M",
            "--retries", "10", "--low-level-retries", "20",
            "--stats", "30s", "--stats-one-line"
        )

        $afterInfo = Get-Item -LiteralPath $item.Source
        if ([int64] $afterInfo.Length -ne $sourceBytes) {
            throw "Source changed during transfer: $($item.Source)"
        }

        $remoteBytes = Get-RemoteBytes $item.Remote
        if ($remoteBytes -ne $sourceBytes) {
            throw "Remote size mismatch for $($item.Remote): expected $sourceBytes, got $remoteBytes"
        }

        Remove-Item -LiteralPath $item.Source -Force
        Write-Log "VERIFIED and deleted local source: $($item.Source)"
    }
    catch {
        Write-Log "STOPPED on failure for $($item.Source): $($_.Exception.Message)"
        exit 1
    }
}

Write-Log "All ZIP archives completed and verified."
