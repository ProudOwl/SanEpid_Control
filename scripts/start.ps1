param(
    [int]$Port = 8080,
    [switch]$Background
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$serverDir = Join-Path $root "server"
$dataDir = Join-Path $env:LOCALAPPDATA "sanepid-monitor"
$venv = Join-Path $serverDir ".venv"
$python = Join-Path $venv "Scripts\python.exe"

Write-Host "=== SanEpid Control ===" -ForegroundColor Cyan

# Stop previous instance on same port
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# Use 'py' launcher instead of python
$pyLauncher = "py"

# Check if python is available
try {
    $pyVersion = & $pyLauncher --version 2>&1
    Write-Host "Using: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "Python not found! Install Python 3.12+" -ForegroundColor Red
    pause
    exit 1
}

# Create venv if needed
if (-not (Test-Path $python)) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    & $pyLauncher -m venv $venv
    if (-not (Test-Path $python)) { 
        Write-Host "Failed to create venv" -ForegroundColor Red
        pause
        exit 1
    }
}

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
& $python -m pip install flask PyJWT gunicorn --quiet
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to install dependencies" -ForegroundColor Red
    pause
    exit 1
}

# Environment
$env:PORT = $Port
$env:BIND_HOST = "127.0.0.1"
$env:STATIC_DIR = Join-Path $root "frontend"
$env:DB_PATH = Join-Path $dataDir "sanepid.db"
$env:JWT_SECRET = "sanepid-jwt-secret-min-32-characters-long"

# Load SMTP config
$smtpFiles = @(
    (Join-Path $root "config\smtp.env"),
    (Join-Path $dataDir "smtp.env")
)
foreach ($f in $smtpFiles) {
    if (Test-Path $f) {
        Get-Content $f -Encoding UTF8 | ForEach-Object {
            if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
            $p = $_ -split '=', 2
            Set-Item -Path "env:$($p[0].Trim())" -Value $p[1].Trim().Trim('"')
        }
        Write-Host "SMTP config: $f" -ForegroundColor Green
        break
    }
}
if (-not $env:SMTP_HOST) {
    Write-Host "SMTP не настроен! Запустите НАСТРОЙКА_ПОЧТЫ.bat" -ForegroundColor Yellow
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

$url = "http://127.0.0.1:$Port"
$pidFile = Join-Path $dataDir "server.pid"

if ($Background) {
    if (Test-Path $pidFile) {
        $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
        if ($oldPid) { Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue }
    }
    $log = Join-Path $dataDir "server.log"
    Set-Location $serverDir
    $proc = Start-Process -FilePath $python -ArgumentList "app.py" -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError (Join-Path $dataDir "server.err")
    $proc.Id | Set-Content $pidFile
    Write-Host "Server started in background (PID $($proc.Id))" -ForegroundColor Green
    return
}

@($url, "", "SanEpid Control local only") |
    Set-Content (Join-Path $root "PUBLIC_URL.txt") -Encoding utf8

Write-Host ""
Write-Host "OK: $url" -ForegroundColor Green
Write-Host ""

Start-Process $url
Set-Location $serverDir
& $python app.py