
# Script pour construire le client Windows (.exe) avec LibMPV

$ErrorActionPreference = "Stop"
$LibDir = "$PSScriptRoot/client/src-tauri/lib"
$LibMpvDll = "$LibDir/libmpv-2.dll"

Write-Host "=== Preparation du build MyFlix Client (LibMPV) ===" -ForegroundColor Cyan

# 1. Verification de LibMPV
if (-not (Test-Path $LibMpvDll)) {
    Write-Host "[WARN] LibMPV manquant !" -ForegroundColor Yellow
    Write-Host "Le plugin tauri-plugin-libmpv a besoin de libmpv-2.dll."
    Write-Host "Veuillez vous assurer que les fichiers suivants existent :"
    Write-Host " - $LibDir/libmpv-2.dll"
    Write-Host " - $LibDir/libmpv-wrapper.dll"
    Write-Host ""
    Write-Host "Vous pouvez utiliser le script de setup du plugin ou telecharger manuellement."
    exit 1
} else {
    Write-Host "[OK] LibMPV trouve." -ForegroundColor Green
}

# 2. Installation des dependances
Write-Host "[INFO] Installation des dependances Node..." -ForegroundColor Cyan
Push-Location "$PSScriptRoot/client"

npm install
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Error "npm install failed"
    exit 1
}

# 3. Build Tauri
Write-Host "[INFO] Construction de l'application..." -ForegroundColor Cyan
# On utilise npx tauri build pour s'assurer d'utiliser la version locale
$env:TAURI_SKIP_DEVSERVER_CHECK = "true" 
# Skip check parfois necessaire si le dev server ne repond pas assez vite ou n'est pas lance
# Mais pour un build de prod, on veut que ca build le frontend d'abord.
# "beforeBuildCommand": "npm run build" dans tauri.conf.json s'en occupe.

npx tauri build
$BuildExitCode = $LASTEXITCODE
Pop-Location

if ($BuildExitCode -eq 0) {
    Write-Host "[SUCCESS] Build termine avec succes !" -ForegroundColor Green
    Write-Host "L'executable se trouve dans :"
    Write-Host "client/src-tauri/target/release/bundle/nsis/MyFlix_0.1.0_x64-setup.exe"
} else {
    Write-Host "[ERROR] Erreur lors du build." -ForegroundColor Red
    exit $BuildExitCode
}
