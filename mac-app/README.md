# Lighthouse — macOS wrapper

A tiny native Mac app that wraps Lighthouse. Spawns the Node backend on launch, shows the dashboard in a WKWebView, kills the server on quit. Pure WebKit — no Electron, no Chromium, no Tauri toolchain.

~5MB binary. ~150 lines of Swift.

## What you get

- Real **Dock icon** + **Cmd-Tab identity** as "Lighthouse," not "Safari"
- Real **macOS menu bar** (File, Edit, View, Window, Help)
- **Status bar item** with: Show Lighthouse / Open in Browser / Restart Server / View Server Log / Quit
- **Cmd-Q** stops the server cleanly (no orphaned `tsx` process)
- Closing the window doesn't quit — Dock click brings it back
- External links (`target="_blank"`, "Open in ClickUp ↗") route to your default browser instead of detouring the dashboard window
- Logs at `~/Library/Logs/Lighthouse.log` for diagnosis
- If you already have `npm start` running in a terminal, the app reuses that server instead of fighting for port 3000

## Build

Once. Requires only the Xcode command-line tools:

```bash
xcode-select --install   # if you don't have them yet
cd mac-app
./build.sh
```

Produces `Lighthouse.app` in this directory. Drag to `/Applications`:

```bash
mv Lighthouse.app /Applications/
open /Applications/Lighthouse.app
```

## Requirements

- macOS 13.0+ (Ventura or newer)
- Node.js installed (Homebrew, /usr/local, or nvm — the app probes the common locations)
- The Lighthouse repo at `~/claude/adhd` (or set a custom path — see below)
- `npm install` has been run in `~/claude/adhd/backend` so `node_modules/.bin/tsx` exists

## Custom backend path

If your repo isn't at `~/claude/adhd/backend`:

```bash
defaults write com.rogermzy.lighthouse LighthouseBackendPath /full/path/to/backend
```

Takes effect on next launch. Reset to default by deleting the key:

```bash
defaults delete com.rogermzy.lighthouse LighthouseBackendPath
```

## What it does on launch

1. Checks if `http://127.0.0.1:3000/api/meta` is already responding. If yes, just points the webview at it.
2. Otherwise, spawns `node node_modules/.bin/tsx src/index.ts` from the backend folder.
3. Polls every 500ms for up to 15 seconds until the API responds.
4. Loads `http://127.0.0.1:3000` in the embedded WKWebView.
5. While polling, shows a loading screen (cream paper, accent spinner) — matches the dashboard's design vocabulary.

If the server fails to start, you get a native alert with the underlying error and the option to Retry or Quit.

## Files

```
mac-app/
├── Sources/
│   ├── main.swift           # NSApplication bootstrap
│   ├── AppDelegate.swift    # Window, menus, status item, navigation routing
│   └── ServerManager.swift  # Spawn / detect / poll / kill the Node process
├── Info.plist               # CFBundle metadata + localhost ATS exception
├── build.sh                 # swiftc + bundle into .app
└── README.md
```

## Custom app icon

Ships with a generated icon (cream squircle + accent target glyph + halftone texture — matches the dashboard's design vocabulary). Source lives in `make-icon.swift` — pure CoreGraphics, no design tool required. To tweak colors / shapes:

```bash
# Edit make-icon.swift, then:
rm Resources/AppIcon.icns
./build.sh   # auto-regenerates the .icns and bundles it
```

To swap in a hand-designed icon entirely, drop your own `AppIcon.icns` at `Resources/AppIcon.icns` and rebuild.

## Launch at login

Click the status bar icon → **Launch at Login** to toggle. Uses macOS 13+'s `SMAppService` API — no LaunchAgents plist, no helper bundle needed. The checkmark stays in sync if you toggle from System Settings → General → Login Items.

## Optional polish you can add

- **Universal binary** (Intel + Apple Silicon): see the commented section at the bottom of `build.sh`.
- **Notarization for distribution**: only needed if you want friends to install via download without Gatekeeper warnings. Personal use doesn't need it (`codesign --sign -` runs ad-hoc).

## Why not Electron / Tauri?

Both ship their own renderer. On macOS, WebKit (which Apple tunes for the OS) feels more native than Chromium. This wrapper uses WKWebView directly — same engine Safari uses — so scrolling, fonts, gestures, context menus all feel like native Mac chrome. The binary is also ~5MB vs. ~150MB (Electron) or ~10–15MB (Tauri).
