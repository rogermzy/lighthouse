#!/bin/bash
# Build script — compiles the Swift sources, assembles a .app bundle,
# strips dev symbols. No Xcode project needed; just `xcode-select --install`
# for the swiftc + Cocoa SDKs.
#
# Output: ./Lighthouse.app — drag to /Applications or just double-click.

set -euo pipefail
cd "$(dirname "$0")"

APP="Lighthouse"
BUNDLE="$APP.app"
MACOS_DIR="$BUNDLE/Contents/MacOS"
RES_DIR="$BUNDLE/Contents/Resources"

# Detect host arch — build native by default. Override with TARGET env if
# you want a Universal binary (see notes at bottom).
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  DEFAULT_TARGET="arm64-apple-macos13.0" ;;
  x86_64) DEFAULT_TARGET="x86_64-apple-macos13.0" ;;
  *)      echo "unknown arch: $ARCH"; exit 1 ;;
esac
TARGET="${TARGET:-$DEFAULT_TARGET}"

echo "Building Lighthouse.app for $TARGET …"
rm -rf "$BUNDLE"
mkdir -p "$MACOS_DIR" "$RES_DIR"

# Generate the app icon if missing. make-icon.swift draws the iconset via
# CoreGraphics and runs iconutil to produce Resources/AppIcon.icns.
if [ ! -f Resources/AppIcon.icns ]; then
  echo "Generating AppIcon.icns…"
  swift make-icon.swift
fi
cp Resources/AppIcon.icns "$RES_DIR/AppIcon.icns"

swiftc \
  -framework Cocoa \
  -framework WebKit \
  -framework ServiceManagement \
  -target "$TARGET" \
  -O \
  Sources/*.swift \
  -o "$MACOS_DIR/$APP"

cp Info.plist "$BUNDLE/Contents/"

# Optional: drop an icon at Resources/AppIcon.icns and add the matching
# CFBundleIconFile entry to Info.plist. Skipped by default.

# Code-sign with an ad-hoc signature so Gatekeeper doesn't quarantine the
# binary every time. Real distribution would use a Developer ID signature
# + notarization, but for personal local use ad-hoc is enough.
codesign --force --sign - "$BUNDLE" 2>/dev/null || true

echo "Built: $BUNDLE"
echo ""
echo "Run with:    open $BUNDLE"
echo "Install with: mv $BUNDLE /Applications/"
echo ""
echo "─────────────────────────────────────────────────────────────────"
echo "  For Universal (Intel + Apple Silicon) binary:"
echo "    TARGET=arm64-apple-macos13.0  ./build.sh   # produces ARM"
echo "    TARGET=x86_64-apple-macos13.0 ./build.sh   # produces Intel"
echo "    lipo -create -output …                     # combine"
echo "─────────────────────────────────────────────────────────────────"
