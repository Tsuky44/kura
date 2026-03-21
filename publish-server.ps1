$GitHubUser = "tsuky44" # Ton nom d'utilisateur GitHub (en minuscules)
$ImageName = "myflix-server"

# TENTATIVE DE CORRECTION AUTOMATIQUE DU PATH DOCKER
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    $PossiblePath = "C:\Program Files\Docker\Docker\resources\bin"
    if (Test-Path $PossiblePath) {
        Write-Host "Docker non trouvé dans le PATH, ajout temporaire de : $PossiblePath" -ForegroundColor Yellow
        $env:PATH = "$env:PATH;$PossiblePath"
    }
}

Write-Host "=== Publication de MyFlix Server vers GitHub Packages (ghcr.io) ===" -ForegroundColor Cyan
Write-Host "NOTE : Assurez-vous d'être connecté :"
Write-Host "  docker login ghcr.io -u $GitHubUser"
Write-Host "  (Utilisez un Personal Access Token avec les droits 'write:packages' comme mot de passe)"
Write-Host ""

function Check-Error {
    param([string]$Message)
    if ($LASTEXITCODE -ne 0) {
        Write-Error "ERREUR : $Message (Code de sortie: $LASTEXITCODE)"
        exit 1
    }
}

# 1. Build
Write-Host "1. Construction de l'image Docker..." -ForegroundColor Yellow
# On se place dans le dossier racine et on pointe vers ./server
docker build -t "ghcr.io/$GitHubUser/$($ImageName):latest" ./server
Check-Error "Échec du build de l'image $ImageName"

# 2. Push
Write-Host "2. Envoi vers GitHub Packages..." -ForegroundColor Yellow
docker push "ghcr.io/$GitHubUser/$($ImageName):latest"
Check-Error "Échec du push de l'image $ImageName"

Write-Host "=== Terminé avec succès ! ===" -ForegroundColor Green
Write-Host "Image disponible sur : ghcr.io/$GitHubUser/$($ImageName):latest"
Write-Host ""
Write-Host "Pour l'utiliser sur ton serveur, mets à jour ton docker-compose.yml :"
Write-Host "image: ghcr.io/$GitHubUser/$($ImageName):latest"
