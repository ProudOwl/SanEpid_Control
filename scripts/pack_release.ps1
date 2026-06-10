param(
    [string]$OutName = "SanEpid_for_friend"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dest = Join-Path $root $OutName

Write-Host "=== Pack release ===" -ForegroundColor Cyan

if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force
}
New-Item -ItemType Directory -Path $dest | Out-Null

foreach ($d in @("frontend", "scripts", "config", ".github")) {
    $src = Join-Path $root $d
    if (Test-Path $src) {
        Copy-Item $src (Join-Path $dest $d) -Recurse -Force
    }
}

$serverDest = Join-Path $dest "server"
New-Item -ItemType Directory -Path $serverDest | Out-Null
Get-ChildItem (Join-Path $root "server") -File | Copy-Item -Destination $serverDest -Force

$skip = @("PUBLIC_URL.txt", "PUBLIC_QR.html")
Get-ChildItem $root -File | Where-Object {
    $_.Name -notin $skip -and (
        $_.Extension -in @(".bat", ".md", ".txt") -or
        $_.Name -in @("Dockerfile", "render.yaml", ".gitignore")
    )
} | Copy-Item -Destination $dest -Force

$smtpSecret = Join-Path $dest "config\smtp.env"
if (Test-Path $smtpSecret) {
    Remove-Item $smtpSecret -Force
}

$zipPath = Join-Path $root "$OutName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $dest -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "Folder:" -ForegroundColor Green
Write-Host $dest
Write-Host ""
Write-Host "Zip:" -ForegroundColor Green
Write-Host $zipPath
Write-Host ""
Write-Host "Send the zip file to your friend." -ForegroundColor Yellow
