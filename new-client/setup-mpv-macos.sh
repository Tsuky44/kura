#!/bin/bash
# setup-mpv-macos.sh - Télécharge et prépare MPV pour macOS

set -e

echo "📦 Setting up MPV for macOS..."

# Créer le dossier libs s'il n'existe pas
mkdir -p src-tauri/libs

cd src-tauri/libs

# Méthode 1: Télécharger depuis Homebrew bottle (recommandé)
# C'est un prébuild officiel qui fonctionne sur Intel et Apple Silicon
if [ ! -f "libmpv.dylib" ]; then
    echo "⬇️  Downloading MPV from Homebrew..."
    
    # Détecter l'architecture
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        BOTTLE_URL="https://ghcr.io/v2/homebrew/core/mpv/blobs/sha256:arm64"
    else
        BOTTLE_URL="https://ghcr.io/v2/homebrew/core/mpv/blobs/sha256:intel"
    fi
    
    # Alternative: télécharger directement le bottle
    curl -L -o mpv-bottle.tar.gz "https://formulae.brew.sh/api/formula/mpv.bottle.tar.gz" 2>/dev/null || true
    
    # Si ça échoue, on utilise brew directement
    if [ ! -f "mpv-bottle.tar.gz" ] || [ ! -s "mpv-bottle.tar.gz" ]; then
        echo "⚠️  Bottle download failed, using local brew..."
        
        # Vérifier si mpv est installé
        if ! brew list mpv &>/dev/null; then
            echo "🍺 Installing MPV via Homebrew..."
            brew install mpv
        fi
        
        # Copier les libs
        MPV_PREFIX=$(brew --prefix mpv)
        
        # Copier libmpv
        cp "$MPV_PREFIX/lib/libmpv.2.dylib" ./libmpv.2.dylib 2>/dev/null || \
        cp "$MPV_PREFIX/lib/libmpv.dylib" ./libmpv.dylib 2>/dev/null || \
        echo "❌ Could not find libmpv"
        
        # Copier les dépendances si nécessaire
        for lib in "$MPV_PREFIX"/lib/lib*.dylib; do
            if [ -f "$lib" ]; then
                cp "$lib" ./ 2>/dev/null || true
            fi
        done
    fi
    
    # Renommer pour avoir un nom standard
    if [ -f "libmpv.2.dylib" ] && [ ! -f "libmpv.dylib" ]; then
        ln -sf libmpv.2.dylib libmpv.dylib
    fi
fi

# Vérifier que la lib est présente
if [ -f "libmpv.dylib" ] || [ -f "libmpv.2.dylib" ]; then
    echo "✅ MPV library ready!"
    ls -la libmpv*.dylib
else
    echo "❌ Failed to get MPV library"
    exit 1
fi

cd ../..

echo ""
echo "🎉 Setup complete! You can now build the app:"
echo "   cd new-client"
echo "   cargo tauri build --target universal-apple-darwin"
