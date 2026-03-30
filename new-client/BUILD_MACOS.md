# Build macOS avec MPV embarqué

Ce guide explique comment créer un installateur macOS avec MPV embarqué (pas besoin d'installer MPV séparément).

## 📋 Prérequis

- macOS 10.13+ (Intel ou Apple Silicon)
- [Homebrew](https://brew.sh) installé
- Rust : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- Node.js 20+ : `brew install node`

## 🚀 Étapes de build

### 1. Préparer MPV

```bash
cd new-client

# Rendre le script exécutable
chmod +x setup-mpv-macos.sh

# Exécuter le script (télécharge/copie libmpv)
./setup-mpv-macos.sh
```

Ce script va :
- Installer MPV via Homebrew si pas déjà fait
- Copier `libmpv.dylib` dans `src-tauri/libs/`

### 2. Installer les dépendances npm

```bash
npm install
```

### 3. Build l'application

**Option A - Build universel (Intel + Apple Silicon)** ⭐ Recommandé :
```bash
# Ajouter les targets
rustup target add x86_64-apple-darwin aarch64-apple-darwin

# Build
npm run tauri build -- --target universal-apple-darwin
```

**Option B - Build Apple Silicon uniquement** :
```bash
npm run tauri build -- --target aarch64-apple-darwin
```

**Option C - Build Intel uniquement** :
```bash
npm run tauri build -- --target x86_64-apple-darwin
```

### 4. Récupérer l'installateur

Après le build, l'installateur est dans :

```
src-tauri/target/
  ├── universal-apple-darwin/release/bundle/dmg/Kuma_0.1.0_universal.dmg  ← Universel
  └── aarch64-apple-darwin/release/bundle/dmg/Kuma_0.1.0_aarch64.dmg      ← Apple Silicon
```

## 📦 Structure du bundle

L'app bundle macOS contient :

```
Kuma.app/
└── Contents/
    ├── MacOS/           ← Exécutable principal
    ├── Resources/       ← libmpv.dylib est copié ici
    └── Frameworks/      ← Frameworks système
```

Le code Rust définit automatiquement `DYLD_LIBRARY_PATH` pour pointer vers `Contents/Resources/` où se trouve `libmpv.dylib`.

## 🔧 Dépannage

### "libmpv not found"

Vérifie que le script a bien copié les libs :
```bash
ls -la src-tauri/libs/
# Doit afficher libmpv.dylib ou libmpv.2.dylib
```

### Build universal échoue

Parfois le build universal nécessite des libs pour les deux archs. Essaie d'abord un build simple :
```bash
npm run tauri build
```

### Signature / Notarization (pour distribution)

Pour distribuer l'app hors Mac App Store, il faut signer et notariser :

```bash
# Signer avec ton certificat Apple Developer
 codesign --force --deep --sign "Developer ID Application: Your Name" Kuma.app

# Créer le DMG
create-dmg \
  --volname "Kuma Installer" \
  --window-size 800 400 \
  --icon-size 100 \
  --app-drop-link 600 185 \
  "Kuma-Installer.dmg" \
  "Kuma.app"
```

## 🔄 Différence avec Windows

| Aspect | Windows | macOS |
|--------|---------|-------|
| Librairie | `libmpv-2.dll` | `libmpv.dylib` |
| Localisation | À côté de l'exe | `Contents/Resources/` |
| Chargement | Auto (dans PATH) | Via `DYLD_LIBRARY_PATH` |
| Installateur | `.msi` ou `.exe` | `.dmg` ou `.app` |

## ✨ Vérifier que ça marche

1. Installe l'app sur un Mac sans MPV (ou désinstalle `brew uninstall mpv`)
2. Lance l'app
3. Joue une vidéo
4. Si la vidéo se lance → MPV est bien embarqué ! 🎉
