#!/bin/bash
# Kuma Launcher - Contourne les restrictions SIP de macOS

# Trouver le bundle
if [ -z "$1" ]; then
    # Chercher le bundle dans le dossier de build
    BUNDLE_PATH="$HOME/Documents/project-mac/kura/new-client/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Kuma.app"
else
    BUNDLE_PATH="$1"
fi

if [ ! -d "$BUNDLE_PATH" ]; then
    echo "❌ Bundle non trouvé: $BUNDLE_PATH"
    echo "Usage: $0 [chemin/vers/Kuma.app]"
    exit 1
fi

EXE_PATH="$BUNDLE_PATH/Contents/MacOS/new-client"
RESOURCES_PATH="$BUNDLE_PATH/Contents/Resources"

echo "🎬 Lancement de Kuma avec MPV..."
echo "📦 Bundle: $BUNDLE_PATH"
echo "📁 Resources: $RESOURCES_PATH"

# Vérifier les libs
echo ""
echo "🔍 Vérification des librairies:"
ls -la "$RESOURCES_PATH"/*.dylib 2>/dev/null | while read line; do
    echo "   $line"
done

# Configurer les chemins de librairies
export DYLD_FALLBACK_LIBRARY_PATH="$RESOURCES_PATH:/opt/homebrew/lib:$DYLD_FALLBACK_LIBRARY_PATH"
export DYLD_LIBRARY_PATH="$RESOURCES_PATH:$DYLD_LIBRARY_PATH"

# Désactiver la quarantaine pour cette session
export DYLD_PRINT_LIBRARIES=1  # Debug: afficher les libs chargées

echo ""
echo "🔧 Environnement configuré:"
echo "   DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH"
echo ""
echo "🚀 Lancement de l'application..."
echo ""

# Lancer l'application
exec "$EXE_PATH"
