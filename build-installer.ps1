# Script to build the new client installer

$ErrorActionPreference = "Stop"

Write-Host "Starting build process for MyFlix New Client..." -ForegroundColor Green

# Navigate to the new client directory
$projectRoot = "c:\Users\Mathis\Documents\Project\myflix"
$clientDir = "$projectRoot\new-client"

if (-not (Test-Path $clientDir)) {
    Write-Error "Client directory not found: $clientDir"
    exit 1
}

Set-Location -Path $clientDir

# Install dependencies if node_modules is missing or just to be safe
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Cyan
    npm install
}

# Build the application
Write-Host "Building Tauri application..." -ForegroundColor Cyan
# Using -- to pass arguments to the underlying tauri CLI
npm run tauri build -- --target x86_64-pc-windows-msvc

# Locate the installer
$installerDir = "$clientDir\src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis"
if (Test-Path $installerDir) {
    $installers = Get-ChildItem -Path $installerDir -Filter "*.exe"
    
    if ($installers.Count -gt 0) {
        foreach ($installer in $installers) {
            $dest = "$projectRoot\$($installer.Name)"
            Copy-Item -Path $installer.FullName -Destination $dest -Force
            Write-Host "Installer copied to: $dest" -ForegroundColor Green
        }
        
        Write-Host "Build successful! You can find the installer in $projectRoot" -ForegroundColor Green
    } else {
        Write-Error "Build finished but no .exe installer found in $installerDir"
    }
} else {
    Write-Error "Build directory not found: $installerDir. Build might have failed."
}

Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
