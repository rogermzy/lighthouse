import Cocoa
import WebKit
import ServiceManagement

class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var serverManager: ServerManager?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenu()
        setupStatusItem()
        setupWindow()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Kill the Node child process so we don't leave a zombie server
        // hogging port 3000 after the app quits.
        serverManager?.stop()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Keep running in the background when the user closes the window —
        // they can re-open via Dock click or status bar item. Quit only via
        // Cmd-Q / explicit menu action.
        return false
    }

    // Re-open window when user clicks Dock icon after closing it.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { showWindow() }
        return true
    }

    // MARK: - Window

    private func setupWindow() {
        // Standard styleMask (no .fullSizeContentView) — the previous setup
        // had the web content rendering BEHIND the titlebar, which slammed
        // the dashboard's topbar (greeting + Suggest btn + icons) under the
        // traffic-light buttons. With the title bar as its own region, the
        // dashboard topbar gets clean space.
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1400, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        // CRITICAL: NSWindow defaults to isReleasedWhenClosed = true, which
        // means closing the window with the red traffic light deallocates
        // the underlying NSWindow object. Our `self.window` stored property
        // then points at freed memory, and the next Dock-click-to-reopen
        // (applicationShouldHandleReopen → showWindow → window?.makeKey...)
        // crashes with EXC_BAD_ACCESS. Disable the auto-release so the
        // strong reference in `self.window` is the source of truth for the
        // window's lifetime — it stays alive while closed and just becomes
        // hidden, ready to re-key on reopen.
        win.isReleasedWhenClosed = false
        win.title = "Lighthouse"
        win.setFrameAutosaveName("LighthouseMainWindow")
        win.center()

        let config = WKWebViewConfiguration()
        // Allow right-click → Inspect Element on debug builds. The same hidden
        // preference is what Safari toggles when you enable the developer menu.
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs

        let wv = WKWebView(frame: win.contentView!.bounds, configuration: config)
        wv.autoresizingMask = [.width, .height]
        wv.navigationDelegate = self
        wv.uiDelegate = self
        // Loading state placeholder — replaced once the server is up.
        wv.loadHTMLString(loadingHTML(), baseURL: nil)
        win.contentView?.addSubview(wv)

        win.makeKeyAndOrderFront(nil)

        self.window = win
        self.webView = wv
    }

    private func loadingHTML() -> String {
        return """
        <!doctype html><html><head><style>
          html,body { margin:0; height:100%; background:#f5efe4; color:#3a342c;
            font-family:-apple-system,BlinkMacSystemFont,sans-serif;
            display:flex; align-items:center; justify-content:center; }
          .box { text-align:center; }
          h1 { font-weight:500; font-size:18px; margin:0 0 6px; }
          p  { margin:0; color:#8a8278; font-size:13px; }
          .spin { width:24px; height:24px; border:2px solid #e3dccd;
            border-top-color:#b8442e; border-radius:999px;
            animation:s 0.9s linear infinite; margin:0 auto 14px; }
          @keyframes s { to { transform:rotate(360deg); } }
        </style></head><body>
          <div class="box">
            <div class="spin"></div>
            <h1>Lighthouse</h1>
            <p>Starting the local server…</p>
          </div>
        </body></html>
        """
    }

    // MARK: - Server lifecycle

    private func startServer() {
        let manager = ServerManager()
        self.serverManager = manager
        manager.start { [weak self] success in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if success {
                    self.webView?.load(URLRequest(url: URL(string: "http://127.0.0.1:3000")!))
                } else {
                    self.showServerError(detail: manager.lastError ?? "Unknown error.")
                }
            }
        }
    }

    private func showServerError(detail: String) {
        let alert = NSAlert()
        alert.messageText = "Couldn't start the Lighthouse server"
        alert.informativeText = """
        \(detail)

        Make sure:
          • Node.js is installed (Homebrew, /usr/local, or nvm)
          • The Lighthouse repo lives at ~/claude/adhd
          • You've run `npm install` in the backend folder

        See ~/Library/Logs/Lighthouse.log for server output.
        """
        alert.addButton(withTitle: "Retry")
        alert.addButton(withTitle: "Quit")
        let response = alert.runModal()
        if response == .alertFirstButtonReturn {
            startServer()
        } else {
            NSApp.terminate(nil)
        }
    }

    // MARK: - Menus

    private func setupMenu() {
        let mainMenu = NSMenu()

        // App menu
        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About Lighthouse",
                                   action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)),
                                   keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Restart Server",
                        action: #selector(restartServer),
                        keyEquivalent: "r",
                        modifiers: [.command, .shift])
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Hide Lighthouse",
                                   action: #selector(NSApplication.hide(_:)),
                                   keyEquivalent: "h"))
        let hideOthersItem = NSMenuItem(title: "Hide Others",
                                        action: #selector(NSApplication.hideOtherApplications(_:)),
                                        keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthersItem)
        appMenu.addItem(NSMenuItem(title: "Show All",
                                   action: #selector(NSApplication.unhideAllApplications(_:)),
                                   keyEquivalent: ""))
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(NSMenuItem(title: "Quit Lighthouse",
                                   action: #selector(NSApplication.terminate(_:)),
                                   keyEquivalent: "q"))
        appMenuItem.submenu = appMenu

        // Edit menu (so cut/copy/paste work inside text fields in the webview)
        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Undo",       action: Selector(("undo:")),                    keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "Redo",       action: Selector(("redo:")),                    keyEquivalent: "Z"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Cut",        action: #selector(NSText.cut(_:)),              keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy",       action: #selector(NSText.copy(_:)),             keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste",      action: #selector(NSText.paste(_:)),            keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)),        keyEquivalent: "a"))
        editMenuItem.submenu = editMenu

        // View menu
        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload",
                         action: #selector(reloadWebView),
                         keyEquivalent: "r",
                         modifiers: [.command])
        viewMenu.addItem(withTitle: "Toggle Full Screen",
                         action: #selector(NSWindow.toggleFullScreen(_:)),
                         keyEquivalent: "f",
                         modifiers: [.command, .control])
        viewMenuItem.submenu = viewMenu

        // Window menu — standard macOS items
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(NSMenuItem(title: "Minimize",
                                      action: #selector(NSWindow.performMiniaturize(_:)),
                                      keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom",
                                      action: #selector(NSWindow.performZoom(_:)),
                                      keyEquivalent: ""))
        windowMenuItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if #available(macOS 11.0, *) {
                button.image = NSImage(systemSymbolName: "scope", accessibilityDescription: "Lighthouse")
            } else {
                button.title = "◉"
            }
            button.toolTip = "Lighthouse"
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Lighthouse",
                                action: #selector(showWindow),
                                keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Open in Browser",
                                action: #selector(openInBrowser),
                                keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Restart Server",
                                action: #selector(restartServer),
                                keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "View Server Log",
                                action: #selector(viewLogs),
                                keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        // Launch-at-login toggle. State is read fresh each time the menu
        // opens (see menuWillOpen) so the checkmark stays in sync if the
        // user toggled it from System Settings.
        let launchItem = NSMenuItem(title: "Launch at Login",
                                    action: #selector(toggleLaunchAtLogin),
                                    keyEquivalent: "")
        menu.addItem(launchItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit",
                                action: #selector(NSApplication.terminate(_:)),
                                keyEquivalent: ""))
        menu.delegate = self
        item.menu = menu
        self.statusItem = item
    }

    // MARK: - NSMenuDelegate — refresh the launch-at-login checkmark on each open
    func menuWillOpen(_ menu: NSMenu) {
        if #available(macOS 13.0, *) {
            if let item = menu.item(withTitle: "Launch at Login") {
                item.state = SMAppService.mainApp.status == .enabled ? NSControl.StateValue.on : NSControl.StateValue.off
            }
        }
    }

    // MARK: - Actions

    @objc private func showWindow() {
        // Defensive: if the window reference somehow went nil (shouldn't
        // happen with isReleasedWhenClosed=false, but belt-and-suspenders),
        // rebuild it so the menu/Dock click doesn't silently no-op.
        if window == nil {
            setupWindow()
            if let manager = serverManager, let url = URL(string: "http://127.0.0.1:3000") {
                _ = manager  // keep ref alive
                webView?.load(URLRequest(url: url))
            }
        }
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func restartServer() {
        webView?.loadHTMLString(loadingHTML(), baseURL: nil)
        serverManager?.stop()
        startServer()
    }

    @objc private func reloadWebView() {
        webView?.reload()
    }

    @objc private func openInBrowser() {
        NSWorkspace.shared.open(URL(string: "http://127.0.0.1:3000")!)
    }

    @objc private func viewLogs() {
        let path = NSString(string: "~/Library/Logs/Lighthouse.log").expandingTildeInPath
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }

    @objc private func toggleLaunchAtLogin() {
        guard #available(macOS 13.0, *) else { return }
        let service = SMAppService.mainApp
        do {
            if service.status == .enabled {
                try service.unregister()
            } else {
                try service.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't update launch-at-login"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }
}

extension AppDelegate: WKNavigationDelegate {
    // Route external links to the default browser; keep localhost traffic
    // in-app. Anything else opening inside the WKWebView would be a
    // confusing detour (the user expects "Open in ClickUp" to actually
    // open ClickUp, not navigate the dashboard window away from itself).
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow); return
        }
        // Internal schemes the WebKit engine uses — allow them through so
        // we don't try to "open in default browser" the splash's about:blank
        // or any data: URI. macOS has no handler for about:blank and would
        // surface "There is no application set to open the URL about:blank."
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "about" || scheme == "data" || scheme == "blob" || url.isFileURL {
            decisionHandler(.allow); return
        }
        let host = url.host ?? ""
        let isLocal = host == "127.0.0.1" || host == "localhost"
        if isLocal {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }
}

extension AppDelegate: WKUIDelegate {
    // Handle `target="_blank"` and window.open() — route to default browser.
    // Same scheme filter as the navigation delegate: don't try to hand
    // about:/data:/blob: URIs to NSWorkspace.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "http" || scheme == "https" || scheme == "mailto" {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

// MARK: - NSMenu convenience

private extension NSMenu {
    func addItem(withTitle title: String,
                 action: Selector,
                 keyEquivalent: String,
                 modifiers: NSEvent.ModifierFlags) {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: keyEquivalent)
        item.keyEquivalentModifierMask = modifiers
        addItem(item)
    }
}
