import Cocoa

// Manual NSApplication bootstrap — no @main / NSApplicationMain because we
// build via raw swiftc (no Xcode project). Equivalent to what the
// NSApplicationMain attribute would do automatically.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
