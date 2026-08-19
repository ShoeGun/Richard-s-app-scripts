[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z]$')]
    [string]$DriveLetter,

    [int]$RequiredGiB = 300
)

$ErrorActionPreference = 'Stop'
$volume = Get-Volume -DriveLetter $DriveLetter
if (-not $volume) { throw "Drive $DriveLetter`: was not found." }
if ($volume.FileSystem -in @($null, '', 'Unknown')) {
    throw "Drive $DriveLetter`: has no usable filesystem. Refusing to format or initialize it."
}
if ($volume.HealthStatus -ne 'Healthy' -or $volume.OperationalStatus -ne 'OK') {
    throw "Drive $DriveLetter`: is not healthy/online."
}

$freeGiB = [math]::Round($volume.SizeRemaining / 1GB, 1)
$root = "${DriveLetter}:\AI\Models\Kimi-K2.5"
[pscustomobject]@{
    Drive = "${DriveLetter}:"
    FileSystem = $volume.FileSystem
    FreeGiB = $freeGiB
    RequiredGiB = $RequiredGiB
    ModelRoot = $root
    Ready = $freeGiB -ge $RequiredGiB
} | Format-List

if ($freeGiB -lt $RequiredGiB) {
    throw "Drive $DriveLetter`: has only $freeGiB GiB free; at least $RequiredGiB GiB is required."
}
