#!/usr/bin/env swift
// Generates AppIcon.icns from scratch using pure CoreGraphics. No NSImage
// (which requires a running NSApplication for lockFocus) — uses CGContext
// directly so it runs cleanly from the command line.
//
// Run with:  swift make-icon.swift
// Produces:  Resources/AppIcon.icns
//
// Design: cream rounded-square background with halftone dot texture and
// a centered accent-red target glyph (matches the dashboard's Today/focus
// iconography and the existing brand vocabulary).

import Foundation
import CoreGraphics
import ImageIO
import AppKit  // For NSBitmapImageRep, but no lockFocus.

// Brand palette
let cream  = CGColor(red: 0.961, green: 0.937, blue: 0.886, alpha: 1)
let accent = CGColor(red: 0.722, green: 0.267, blue: 0.180, alpha: 1)
let halftoneAlpha: CGFloat = 0.10

func drawIcon(size px: Int) -> Data {
    let s = CGFloat(px)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(
        data: nil,
        width: px, height: px,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    ) else {
        fatalError("CGContext init failed for size \(px)")
    }

    // Background: rounded square (Big Sur+ squircle ratio ≈ 22.5%).
    let bgPath = CGPath(roundedRect: CGRect(x: 0, y: 0, width: s, height: s),
                        cornerWidth: s * 0.225, cornerHeight: s * 0.225, transform: nil)
    ctx.addPath(bgPath)
    ctx.setFillColor(cream)
    ctx.fillPath()

    // Clip to the rounded background so subsequent draws stay inside.
    ctx.addPath(bgPath)
    ctx.clip()

    // Halftone dot pattern — faint accent dots on a grid. Same texture
    // the dashboard's halftone overlays use, just lower opacity.
    let spacing = s / 18
    let dotR = max(s / 260, 1)
    ctx.setFillColor(accent.copy(alpha: halftoneAlpha)!)
    var y = spacing / 2
    while y < s {
        var x = spacing / 2
        while x < s {
            ctx.fillEllipse(in: CGRect(x: x - dotR, y: y - dotR, width: dotR * 2, height: dotR * 2))
            x += spacing
        }
        y += spacing
    }

    // Centered target — outer ring + filled inner dot. Reads as a focus
    // beacon and mirrors the Today nav's icon in the dashboard.
    let cx = s / 2
    let cy = s / 2
    let ringR = s * 0.28
    let ringStroke = s * 0.05
    ctx.setStrokeColor(accent)
    ctx.setLineWidth(ringStroke)
    ctx.strokeEllipse(in: CGRect(x: cx - ringR, y: cy - ringR,
                                  width: ringR * 2, height: ringR * 2))
    let innerR = s * 0.105
    ctx.setFillColor(accent)
    ctx.fillEllipse(in: CGRect(x: cx - innerR, y: cy - innerR,
                                width: innerR * 2, height: innerR * 2))

    guard let cgImage = ctx.makeImage() else { fatalError("makeImage failed") }
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else {
        fatalError("CGImageDestination init failed")
    }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { fatalError("PNG finalize failed") }
    return data as Data
}

// .icns expects exactly these filenames in an .iconset directory.
let sizes: [(name: String, px: Int)] = [
    ("icon_16x16.png",      16),
    ("icon_16x16@2x.png",   32),
    ("icon_32x32.png",      32),
    ("icon_32x32@2x.png",   64),
    ("icon_128x128.png",   128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png",   256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png",   512),
    ("icon_512x512@2x.png", 1024),
]

let fm = FileManager.default
let iconsetDir = "AppIcon.iconset"
try? fm.removeItem(atPath: iconsetDir)
try fm.createDirectory(atPath: iconsetDir, withIntermediateDirectories: true)

for (name, px) in sizes {
    let png = drawIcon(size: px)
    try png.write(to: URL(fileURLWithPath: "\(iconsetDir)/\(name)"))
    print("  \(name) (\(px)×\(px))")
}

// Assemble .icns via iconutil (ships with macOS).
try? fm.createDirectory(atPath: "Resources", withIntermediateDirectories: true)
let outPath = "Resources/AppIcon.icns"

let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconsetDir, "-o", outPath]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else {
    FileHandle.standardError.write("iconutil failed (exit \(task.terminationStatus))\n".data(using: .utf8)!)
    exit(1)
}
try? fm.removeItem(atPath: iconsetDir)
print("Wrote \(outPath)")
