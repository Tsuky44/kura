#!/bin/bash
# Kuma Launcher for macOS - Sets library paths for MPV before the process starts.
# DYLD_FALLBACK_LIBRARY_PATH must be set here (parent process) so dlopen()
# can find libmpv.dylib from Homebrew. Setting it inside the app is too late.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESOURCES_DIR="$SCRIPT_DIR/../Resources"

# Homebrew paths (Apple Silicon + Intel)
HOMEBREW_LIBS="/opt/homebrew/lib:/opt/homebrew/opt/mpv/lib:/usr/local/lib:/usr/local/opt/mpv/lib"

export DYLD_FALLBACK_LIBRARY_PATH="$RESOURCES_DIR:$HOMEBREW_LIBS:${DYLD_FALLBACK_LIBRARY_PATH:-}"

echo "[Kuma] Resources: $RESOURCES_DIR"
echo "[Kuma] DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH"

exec "$SCRIPT_DIR/new-client" "$@"
