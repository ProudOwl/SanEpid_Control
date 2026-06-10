param(
    [int]$Port = 8080
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$toolsDir = Join-Path $root "tools"
$urlFile = Join-Path $root "PUBLIC_URL.txt"
$pidFile = Join-Path $toolsDir "tunnel.pid"

function Test-Server {
    param([int]$P)
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect("127.0.0.1", $P, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne(2000, $false)) {
            $client.Close()
            return $false
        }
        if (-not $client.Connected) {
            $client.Close()
            return $false
        }
        $client.Close()
        return $true
    } catch { return $false }
}

function Test-PublicUrl {
    param([string]$Url)
    for ($i = 0; $i -lt 8; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 15
            if ($r.StatusCode -eq 200) { return $true }
        } catch { Start-Sleep -Seconds 2 }
    }
    return $false
}

function Save-PublicUrl {
    param([string]$Url, [int]$P)
    @(
        $Url,
        "",
        "Local: http://127.0.0.1:$P",
        "",
        "Keep this window open during the demo.",
        "Link stops working when you close it."
    ) | Set-Content $urlFile -Encoding utf8
}

Write-Host "=== SanEpid Public Link ===" -ForegroundColor Cyan
Write-Host "Checking local server on port $Port..." -ForegroundColor Gray

$serverOk = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-Server -Port $Port) { $serverOk = $true; break }
    if ($i -eq 0) { Write-Host "Waiting for server..." -ForegroundColor Yellow }
    Start-Sleep -Seconds 1
}

if (-not $serverOk) {
    Write-Host ""
    Write-Host "Local server is not responding on port $Port." -ForegroundColor Red
    Write-Host "1) Run START.bat and wait until the site opens in browser" -ForegroundColor Yellow
    Write-Host "2) Check that http://127.0.0.1:$Port/api/health opens in browser" -ForegroundColor Yellow
    Write-Host "3) Then run PUBLIC.bat again" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

Write-Host "Local server OK: http://127.0.0.1:$Port" -ForegroundColor Green
New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

if (Test-Path $pidFile) {
    Get-Content $pidFile -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Process -Id ([int]$_) -Force -ErrorAction SilentlyContinue
    }
}
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$sshOut = Join-Path $toolsDir "tunnel.out"
$sshErr = Join-Path $toolsDir "tunnel.err"
Remove-Item $sshOut, $sshErr -ErrorAction SilentlyContinue

Write-Host "Creating public link via localhost.run (SSH)..." -ForegroundColor Yellow

$proc = Start-Process -FilePath "ssh" -ArgumentList @(
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-o", "ServerAliveInterval=30",
    "-R", "80:127.0.0.1:$Port",
    "nokey@localhost.run"
) -NoNewWindow -PassThru -RedirectStandardOutput $sshOut -RedirectStandardError $sshErr

$proc.Id | Set-Content $pidFile

$publicUrl = $null
for ($i = 0; $i -lt 45; $i++) {
    Start-Sleep -Seconds 1
    $log = @()
    if (Test-Path $sshOut) { $log += Get-Content $sshOut -ErrorAction SilentlyContinue }
    if (Test-Path $sshErr) { $log += Get-Content $sshErr -ErrorAction SilentlyContinue }
    $logText = ($log -join "`n")
    if ($logText -match '(https://[a-z0-9-]+\.localhost\.run)') {
        $publicUrl = $Matches[1]
        break
    }
    if ($logText -match '(https://[a-z0-9-]+\.lhr\.life)') {
        $publicUrl = $Matches[1]
        break
    }
}

if (-not $publicUrl) {
    Write-Host "localhost.run failed. Trying Cloudflare (HTTP/2)..." -ForegroundColor Yellow
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue

    $cf = Join-Path $toolsDir "cloudflared.exe"
    if (-not (Test-Path $cf)) {
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf
    }

    $cfLog = Join-Path $toolsDir "tunnel.err"
    Remove-Item $cfLog -ErrorAction SilentlyContinue
    $env:TUNNEL_TRANSPORT_PROTOCOL = "http2"

    $proc = Start-Process -FilePath $cf -ArgumentList @(
        "tunnel", "--url", "http://127.0.0.1:$Port", "--protocol", "http2"
    ) -NoNewWindow -PassThru -RedirectStandardOutput $cfLog -RedirectStandardError $cfLog

    $proc.Id | Set-Content $pidFile

    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        if (-not (Test-Path $cfLog)) { continue }
        foreach ($line in (Get-Content $cfLog -ErrorAction SilentlyContinue)) {
            if ($line -match '(https://[a-z0-9-]+\.trycloudflare\.com)') {
                $publicUrl = $Matches[1]
                break
            }
        }
        if ($publicUrl) { break }
    }
}

if (-not $publicUrl) {
    Write-Host "Could not create public link." -ForegroundColor Red
    Write-Host "See tools/tunnel.log or use Render.com (DEPLOY.md)." -ForegroundColor Yellow
    if (Test-Path $sshOut) { Get-Content $sshOut -Tail 10 }
    if (Test-Path $sshErr) { Get-Content $sshErr -Tail 10 }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "Verifying link..." -ForegroundColor Gray
if (-not (Test-PublicUrl -Url $publicUrl)) {
    Write-Host "Warning: link created but health check slow. Try opening manually." -ForegroundColor Yellow
}

Save-PublicUrl -Url $publicUrl -Port $Port

Write-Host ""
Write-Host "PUBLIC LINK:" -ForegroundColor Green
Write-Host $publicUrl -ForegroundColor White -BackgroundColor DarkGreen
Write-Host ""
Write-Host "Saved to PUBLIC_URL.txt" -ForegroundColor Gray
Write-Host "Do NOT close this window until the demo ends." -ForegroundColor Yellow
Write-Host ""

Start-Process $publicUrl

try {
    Wait-Process -Id $proc.Id
} finally {
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}
