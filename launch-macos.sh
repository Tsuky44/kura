#!/bin/bash
# launch-macos.sh - Dev launcher for macOS.
# Sets DYLD_FALLBACK_LIBRARY_PATH BEFORE the process starts so that
# dlopen("libmpv.dylib") can find the Homebrew-installed libmpv and its deps.
# This must be set in the parent shell; setting it inside Rust/Tauri is too late.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Homebrew library paths (Apple Silicon + Intel fallback)
HOMEBREW_LIBS="/opt/homebrew/lib:/opt/homebrew/opt/mpv/lib:/usr/local/lib:/usr/local/opt/mpv/lib"

# Also include the src-tauri/libs dir for the dev build dylibs
SRC_LIBS="$SCRIPT_DIR/new-client/src-tauri/libs"

export DYLD_FALLBACK_LIBRARY_PATH="$SRC_LIBS:$HOMEBREW_LIBS:${DYLD_FALLBACK_LIBRARY_PATH:-}"

echo "[launch-macos] DYLD_FALLBACK_LIBRARY_PATH=$DYLD_FALLBACK_LIBRARY_PATH"
echo "[launch-macos] Starting dev server..."

# Ensure cargo/rustup are on PATH (needed when launched outside a login shell)
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

cd "$SCRIPT_DIR/new-client" && npm run tauri dev
