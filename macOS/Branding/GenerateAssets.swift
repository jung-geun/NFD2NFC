import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// One geometric source for the app icon, vector logo, website favicon and menu-bar template.
// Run from any directory: xcrun swift macOS/Branding/GenerateAssets.swift
let macOS = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
let repository = macOS.deletingLastPathComponent()
let branding = macOS.appendingPathComponent("Branding", isDirectory: true)
let catalog = macOS.appendingPathComponent("NFD2NFC/Assets.xcassets", isDirectory: true)
let iconset = repository.appendingPathComponent("resources/icon.iconset", isDirectory: true)
let fileManager = FileManager.default
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
let info: [String: Any] = ["author": "xcode", "version": 1]

enum Segment {
    case move(CGFloat, CGFloat)
    case line(CGFloat, CGFloat)
    case curve(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)
    case close
}

let cap: [Segment] = [
    .move(24, 88), .line(24, 58),
    .curve(24, 39, 39, 24, 58, 24),
    .curve(73, 24, 86, 32, 93, 44),
    .line(24, 88), .close
]
let body: [Segment] = [
    .move(24, 101), .line(97, 55), .line(172, 137), .line(172, 58),
    .curve(172, 39, 187, 24, 206, 24),
    .curve(225, 24, 240, 39, 240, 58), .line(240, 198),
    .curve(240, 217, 225, 232, 206, 232),
    .curve(196, 232, 187, 228, 180, 220), .line(92, 122), .line(92, 198),
    .curve(92, 217, 77, 232, 58, 232),
    .curve(39, 232, 24, 217, 24, 198), .line(24, 101), .close
]

func path(_ segments: [Segment]) -> CGPath {
    let result = CGMutablePath()
    for segment in segments {
        switch segment {
        case let .move(x, y): result.move(to: CGPoint(x: x, y: y))
        case let .line(x, y): result.addLine(to: CGPoint(x: x, y: y))
        case let .curve(x1, y1, x2, y2, x, y):
            result.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
        case .close: result.closeSubpath()
        }
    }
    return result
}

func svgPath(_ segments: [Segment]) -> String {
    segments.map { segment in
        switch segment {
        case let .move(x, y): return "M\(x) \(y)"
        case let .line(x, y): return "L\(x) \(y)"
        case let .curve(x1, y1, x2, y2, x, y): return "C\(x1) \(y1) \(x2) \(y2) \(x) \(y)"
        case .close: return "Z"
        }
    }.joined(separator: " ")
}

let markPath: CGPath = {
    let result = CGMutablePath()
    result.addPath(path(cap))
    result.addPath(path(body))
    return result
}()

func color(_ hex: UInt32, alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: colorSpace, components: [CGFloat((hex >> 16) & 255) / 255,
        CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, alpha])!
}

func gradient(_ colors: [CGColor]) -> CGGradient {
    CGGradient(colorsSpace: colorSpace, colors: colors as CFArray, locations: [0, 1])!
}

func drawMark(_ context: CGContext, color fill: CGColor) {
    context.addPath(markPath)
    context.setFillColor(fill)
    context.fillPath()
}

func drawIcon(_ context: CGContext) {
    let tile = CGPath(roundedRect: CGRect(x: 96, y: 88, width: 832, height: 832),
        cornerWidth: 182, cornerHeight: 182, transform: nil)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: 16), blur: 28, color: color(0x102A63, alpha: 0.25))
    context.addPath(tile)
    context.setFillColor(color(0x245BDD))
    context.fillPath()
    context.restoreGState()
    context.saveGState()
    context.addPath(tile)
    context.clip()
    context.drawLinearGradient(gradient([color(0x397CF5), color(0x174DD2)]),
        start: CGPoint(x: 320, y: 88), end: CGPoint(x: 680, y: 920), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    context.addPath(tile)
    context.setLineWidth(6)
    context.setStrokeColor(color(0xFFFFFF, alpha: 0.16))
    context.strokePath()
    context.restoreGState()
    context.saveGState()
    context.translateBy(x: 174, y: 176)
    context.scaleBy(x: 2.56, y: 2.56)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: 4), blur: 7, color: color(0x0B2869, alpha: 0.24))
    drawMark(context, color: color(0xF8FBFF))
    context.restoreGState()
    context.addPath(markPath)
    context.clip()
    context.drawLinearGradient(gradient([color(0xFFFFFF), color(0xEDF4FF)]),
        start: CGPoint(x: 96, y: 24), end: CGPoint(x: 160, y: 232), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    context.restoreGState()
}

func ensureDirectory(_ url: URL) throws {
    try fileManager.createDirectory(at: url, withIntermediateDirectories: true)
}

func writeJSON(_ value: [String: Any], to url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    try (data + Data([10])).write(to: url, options: .atomic)
}

func writePNG(pixels: Int, logicalSize: CGFloat, to url: URL, draw: (CGContext) -> Void) throws {
    guard let context = CGContext(data: nil, width: pixels, height: pixels, bitsPerComponent: 8,
        bytesPerRow: pixels * 4, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
        let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw NSError(domain: "BrandAssets", code: 1, userInfo: [NSLocalizedDescriptionKey: "PNG context could not be created"])
    }
    context.translateBy(x: 0, y: CGFloat(pixels))
    context.scaleBy(x: CGFloat(pixels) / logicalSize, y: -CGFloat(pixels) / logicalSize)
    draw(context)
    guard let image = context.makeImage() else { throw NSError(domain: "BrandAssets", code: 2) }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "BrandAssets", code: 3) }
}

func writePDF(points: CGFloat, logicalSize: CGFloat, to url: URL, draw: (CGContext) -> Void) throws {
    var bounds = CGRect(x: 0, y: 0, width: points, height: points)
    guard let consumer = CGDataConsumer(url: url as CFURL), let context = CGContext(consumer: consumer, mediaBox: &bounds, nil) else {
        throw NSError(domain: "BrandAssets", code: 4)
    }
    context.beginPDFPage(nil)
    context.translateBy(x: 0, y: points)
    context.scaleBy(x: points / logicalSize, y: -points / logicalSize)
    draw(context)
    context.endPDFPage()
    context.closePDF()
}

try ensureDirectory(catalog)
try ensureDirectory(iconset)
try writeJSON(["info": info], to: catalog.appendingPathComponent("Contents.json"))
let appIcon = catalog.appendingPathComponent("AppIcon.appiconset", isDirectory: true)
try ensureDirectory(appIcon)
var slots: [[String: Any]] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let filename = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        let destination = appIcon.appendingPathComponent(filename)
        try writePNG(pixels: points * scale, logicalSize: 1024, to: destination, draw: drawIcon)
        let exported = iconset.appendingPathComponent(filename)
        try Data(contentsOf: destination).write(to: exported, options: .atomic)
        slots.append(["idiom": "mac", "size": "\(points)x\(points)", "scale": "\(scale)x", "filename": filename])
    }
}
try writeJSON(["images": slots, "info": info], to: appIcon.appendingPathComponent("Contents.json"))

let brandIcon = catalog.appendingPathComponent("BrandIcon.imageset", isDirectory: true)
try ensureDirectory(brandIcon)
try writePDF(points: 256, logicalSize: 1024, to: brandIcon.appendingPathComponent("BrandIcon.pdf"), draw: drawIcon)
try writeJSON(["images": [["filename": "BrandIcon.pdf", "idiom": "universal"]], "info": info,
    "properties": ["preserves-vector-representation": true]], to: brandIcon.appendingPathComponent("Contents.json"))

let brandMark = catalog.appendingPathComponent("BrandMark.imageset", isDirectory: true)
try ensureDirectory(brandMark)
try writePDF(points: 256, logicalSize: 256, to: brandMark.appendingPathComponent("BrandMark.pdf")) { drawMark($0, color: color(0x2563EB)) }
try writePDF(points: 256, logicalSize: 256, to: brandMark.appendingPathComponent("BrandMark-Dark.pdf")) { drawMark($0, color: color(0x83ADFF)) }
try writeJSON(["images": [
    ["filename": "BrandMark.pdf", "idiom": "universal"],
    ["filename": "BrandMark-Dark.pdf", "idiom": "universal", "appearances": [["appearance": "luminosity", "value": "dark"]]]
], "info": info, "properties": ["preserves-vector-representation": true]], to: brandMark.appendingPathComponent("Contents.json"))

let statusIcon = catalog.appendingPathComponent("StatusBarIcon.imageset", isDirectory: true)
try ensureDirectory(statusIcon)
for scale in [1, 2] {
    try writePNG(pixels: 18 * scale, logicalSize: 18,
        to: statusIcon.appendingPathComponent("StatusBarIcon\(scale == 2 ? "@2x" : "").png")) { context in
        context.translateBy(x: -0.777778, y: -0.481481)
        context.scaleBy(x: 16 / 216, y: 16 / 216)
        drawMark(context, color: color(0x000000))
    }
}
try writeJSON(["images": [
    ["filename": "StatusBarIcon.png", "idiom": "mac", "scale": "1x"],
    ["filename": "StatusBarIcon@2x.png", "idiom": "mac", "scale": "2x"]
], "info": info, "properties": ["template-rendering-intent": "template"]], to: statusIcon.appendingPathComponent("Contents.json"))

let accent = catalog.appendingPathComponent("AccentColor.colorset", isDirectory: true)
try ensureDirectory(accent)
func components(_ red: Int, _ green: Int, _ blue: Int) -> [String: String] {
    ["red": String(format: "%.6f", Double(red) / 255), "green": String(format: "%.6f", Double(green) / 255),
     "blue": String(format: "%.6f", Double(blue) / 255), "alpha": "1.000"]
}
try writeJSON(["colors": [
    ["idiom": "universal", "color": ["color-space": "srgb", "components": components(37, 99, 235)]],
    ["idiom": "universal", "appearances": [["appearance": "luminosity", "value": "dark"]],
     "color": ["color-space": "srgb", "components": components(131, 173, 255)]]
], "info": info], to: accent.appendingPathComponent("Contents.json"))

let paths = "<path d=\"\(svgPath(cap))\"/><path d=\"\(svgPath(body))\"/>"
let title = "<title>NFD2NFC</title><desc>Separated fragments joined into one composed N.</desc>"
for (filename, fill) in [("Logo.svg", "#2563eb"), ("Logo-Monochrome.svg", "currentColor")] {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\">\(title)<g fill=\"\(fill)\">\(paths)</g></svg>\n"
    try svg.write(to: branding.appendingPathComponent(filename), atomically: true, encoding: .utf8)
    if filename == "Logo.svg" {
        try svg.write(to: repository.appendingPathComponent("web/public/favicon.svg"), atomically: true, encoding: .utf8)
    }
}
let iconSVG = """
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  \(title)
  <defs>
    <linearGradient id="tile" x1="0.25" y1="0" x2="0.75" y2="1"><stop stop-color="#397cf5"/><stop offset="1" stop-color="#174dd2"/></linearGradient>
    <linearGradient id="porcelain" x2="0.4" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#edf4ff"/></linearGradient>
    <filter id="shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dy="16" stdDeviation="14" flood-color="#102a63" flood-opacity=".25"/></filter>
  </defs>
  <rect x="96" y="88" width="832" height="832" rx="182" fill="url(#tile)" filter="url(#shadow)"/>
  <rect x="99" y="91" width="826" height="826" rx="179" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="3"/>
  <g transform="translate(174 176) scale(2.56)" fill="url(#porcelain)">
    \(paths)
  </g>
</svg>
"""
try (iconSVG + "\n").write(to: branding.appendingPathComponent("AppIcon.svg"), atomically: true, encoding: .utf8)
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconset.path, "-o", repository.appendingPathComponent("resources/icon.icns").path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else { throw NSError(domain: "BrandAssets", code: Int(iconutil.terminationStatus)) }
print("Generated 10 macOS AppIcon slots, vector brand assets, website favicon, 1x/2x status templates, adaptive accent color and ICNS export.")
