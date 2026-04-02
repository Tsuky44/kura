#!/bin/bash
# prepare-dylibs.sh
# Copies libmpv.dylib (and its direct Homebrew dependencies) into src-tauri/dylibs/
# and rewrites their install names to @rpath so the app bundle is self-contained.
#
# Run this ONCE before `npm run tauri build` on the developer machine.
# The resulting dylibs/ folder should be committed or kept locally.
#
# Usage: ./prepare-dylibs.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DYLIBS_DIR="$SCRIPT_DIR/dylibs"

mkdir -p "$DYLIBS_DIR"

# ---------------------------------------------------------------------------
# 1. Locate libmpv from Homebrew
# ---------------------------------------------------------------------------
HOMEBREW_MPV_LIB=""
for candidate in \
    "/opt/homebrew/opt/mpv/lib/libmpv.dylib" \
    "/opt/homebrew/lib/libmpv.dylib" \
    "/usr/local/opt/mpv/lib/libmpv.dylib" \
    "/usr/local/lib/libmpv.dylib"; do
    if [ -f "$candidate" ]; then
        HOMEBREW_MPV_LIB="$candidate"
        break
    fi
done

if [ -z "$HOMEBREW_MPV_LIB" ]; then
    echo "ERROR: libmpv.dylib not found. Install with: brew install mpv"
    exit 1
fi

echo "[prepare-dylibs] Source: $HOMEBREW_MPV_LIB"

# Resolve symlink to the real versioned dylib
REAL_MPV_LIB="$(readlink -f "$HOMEBREW_MPV_LIB" 2>/dev/null || greadlink -f "$HOMEBREW_MPV_LIB" 2>/dev/null || echo "$HOMEBREW_MPV_LIB")"

DEST="$DYLIBS_DIR/libmpv.dylib"
cp -f "$REAL_MPV_LIB" "$DEST"
chmod 755 "$DEST"

# ---------------------------------------------------------------------------
# 2. Fix install name so the bundle finds it via @rpath
# ---------------------------------------------------------------------------
install_name_tool -id "@rpath/libmpv.dylib" "$DEST"

# Ad-hoc re-sign after modifying (required on Apple Silicon)
codesign --sign - --force "$DEST"

echo "[prepare-dylibs] Created $DEST"
echo ""
echo "NOTE: libmpv.dylib still references Homebrew paths for its OWN dependencies"
echo "(FFmpeg, libass, MoltenVK, etc.). On a machine without Homebrew those will"
echo "be missing and the app will crash. To make a fully standalone .dmg you would"
echo "need to copy and relink all transitive dependencies as well (dylibbundler or"
echo "similar tool can automate this)."
echo ""
echo "For distribution, run after this script:"
echo "  brew install dylibbundler"
echo "  dylibbundler -od -b -x dylibs/libmpv.dylib -d dylibs/ -p @rpath/"
