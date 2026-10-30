import AppKit

struct IconVerificationError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw IconVerificationError(message) }
}

func pixels(_ representation: NSImageRep, size: Int) throws -> Data {
    guard representation.pixelsWide == size, representation.pixelsHigh == size,
          let space = CGColorSpace(name: CGColorSpace.sRGB),
          let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
              bytesPerRow: size * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
          let buffer = context.data else {
        throw IconVerificationError("Cannot decode a \(size)×\(size) icon image")
    }
    NSGraphicsContext.saveGraphicsState()
    defer { NSGraphicsContext.restoreGraphicsState() }
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
    try require(representation.draw(in: CGRect(x: 0, y: 0, width: size, height: size)), "Cannot draw icon representation")
    return Data(bytes: buffer, count: size * size * 4)
}

func slot(points: Int, pixels: Int) -> String { "\(points)pt/\(pixels)px" }

func verify(_ image: NSImage, expected: [String: Data], label: String) throws {
    var found = Set<String>()
    for representation in image.representations {
        let points = Int(representation.size.width)
        let size = representation.pixelsWide
        let key = slot(points: points, pixels: size)
        try require(representation.size.width == CGFloat(points)
            && representation.size.height == representation.size.width,
            "\(label) has an invalid logical icon size")
        guard let canonical = expected[key] else {
            throw IconVerificationError("\(label) has an unexpected icon representation: \(key)")
        }
        try require(found.insert(key).inserted, "\(label) has a duplicate icon representation: \(key)")
        try require(try pixels(representation, size: size) == canonical,
            "\(label) \(key) does not match the current AppIcon; rebuild from the current asset catalog")
    }
    let missing = Set(expected.keys).subtracting(found).sorted()
    try require(missing.isEmpty, "\(label) is missing \(missing.joined(separator: ", ")); set Standalone Icon File Behavior to All and rebuild")
}

func verifyBundle(_ app: URL, scratch: URL) throws {
    let infoData = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
    guard let info = try PropertyListSerialization.propertyList(from: infoData, options: [], format: nil) as? [String: Any],
          let name = info["CFBundleIconFile"] as? String,
          let assetName = info["CFBundleIconName"] as? String else {
        throw IconVerificationError("CFBundleIconFile and CFBundleIconName are required")
    }
    try require(info["CFBundleIdentifier"] as? String == "com.pieroot.nfd2nfc", "Unexpected app bundle identifier")
    // Electron shipped 2.0.3 as its build version. Native builds 1 and 2 sort below it
    // in Launch Services, regardless of the newer CFBundleShortVersionString.
    guard let build = info["CFBundleVersion"] as? String else {
        throw IconVerificationError("CFBundleVersion is missing")
    }
    let components = build.split(separator: ".", omittingEmptySubsequences: false)
    let numbers = components.compactMap { Int($0) }
    try require((1...3).contains(components.count) && numbers.count == components.count
        && components.allSatisfy { !$0.isEmpty && $0.allSatisfy { $0.isASCII && $0.isNumber } },
        "CFBundleVersion must contain one to three nonnegative integer components")
    let version = numbers + Array(repeating: 0, count: 3 - numbers.count)
    try require([2, 0, 3].lexicographicallyPrecedes(version),
        "CFBundleVersion \(build) does not exceed legacy 2.0.3; Launch Services can prefer the old app and icon. Use build 3 or later; marketing version alone does not fix this.")
    let filename = name.hasSuffix(".icns") ? name : name + ".icns"
    let resources = app.appendingPathComponent("Contents/Resources", isDirectory: true)
    let iconURL = resources.appendingPathComponent(filename)
    let icon = try Data(contentsOf: iconURL)
    try require(icon.count >= 8 && icon.prefix(4).elementsEqual("icns".utf8), "\(filename) has an invalid ICNS header")
    func length(at offset: Int) -> Int {
        (Int(icon[offset]) << 24) | (Int(icon[offset + 1]) << 16) | (Int(icon[offset + 2]) << 8) | Int(icon[offset + 3])
    }
    try require(length(at: 4) == icon.count, "\(filename) has an invalid ICNS length")
    var offset = 8
    while offset < icon.count {
        try require(icon.count - offset >= 8, "Truncated ICNS entry")
        let count = length(at: offset + 4)
        try require(count >= 8 && count <= icon.count - offset, "Invalid ICNS entry length")
        offset += count
    }
    guard let standalone = NSImage(contentsOf: iconURL) else {
        throw IconVerificationError("Cannot decode \(filename)")
    }
    let catalog = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("../NFD2NFC/Assets.xcassets/AppIcon.appiconset", isDirectory: true)
    var expected: [String: Data] = [:]
    for points in [16, 32, 128, 256, 512] {
        for scale in [1, 2] {
            let file = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
            guard let source = NSBitmapImageRep(data: try Data(contentsOf: catalog.appendingPathComponent(file))) else {
                throw IconVerificationError("Cannot decode canonical \(file)")
            }
            expected[slot(points: points, pixels: points * scale)] = try pixels(source, size: points * scale)
        }
    }
    try verify(standalone, expected: expected, label: filename)

    // Isolate Assets.car so Bundle cannot silently fall back to the standalone ICNS.
    let catalogBundle = scratch.appendingPathComponent("Catalog.bundle", isDirectory: true)
    let catalogResources = catalogBundle.appendingPathComponent("Contents/Resources", isDirectory: true)
    try FileManager.default.createDirectory(at: catalogResources, withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: resources.appendingPathComponent("Assets.car"),
        to: catalogResources.appendingPathComponent("Assets.car"))
    let catalogInfo: [String: Any] = ["CFBundleIdentifier": "com.pieroot.icon-verification.\(UUID().uuidString)",
        "CFBundlePackageType": "BNDL"]
    try PropertyListSerialization.data(fromPropertyList: catalogInfo, format: .xml, options: 0)
        .write(to: catalogBundle.appendingPathComponent("Contents/Info.plist"))
    guard let bundle = Bundle(url: catalogBundle), let compiled = bundle.image(forResource: NSImage.Name(assetName)) else {
        throw IconVerificationError("Assets.car does not contain \(assetName)")
    }
    try verify(compiled, expected: expected, label: "Assets.car/\(assetName)")
    print("Verified \(app.path): ICNS and Assets.car each contain all 10 current AppIcon representations (16–1024px)")
    print("Bundle \(info["CFBundleIdentifier"] ?? "") \(info["CFBundleShortVersionString"] ?? "") (\(info["CFBundleVersion"] ?? ""))")
    print("Resource verification does not prove the icon rendered by macOS Notification Center; check a fresh notification from this exact distribution build.")
}

func run() throws {
    try require(CommandLine.arguments.count == 2, "Usage: VerifyIcon.swift <NFD2NFC.app|NFD2NFC.pkg>")
    let input = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
    let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("NFD2NFC-icon-verification-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: scratch) }
    var app = input
    if input.pathExtension == "pkg" {
        let expanded = scratch.appendingPathComponent("Expanded", isDirectory: true)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/pkgutil")
        process.arguments = ["--expand-full", input.path, expanded.path]
        try process.run()
        process.waitUntilExit()
        try require(process.terminationStatus == 0, "Cannot expand exported package")
        guard let enumerator = FileManager.default.enumerator(at: expanded,
            includingPropertiesForKeys: [.isDirectoryKey, .isSymbolicLinkKey]) else {
            throw IconVerificationError("Cannot enumerate exported package")
        }
        var apps: [URL] = []
        for case let url as URL in enumerator {
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            if values.isSymbolicLink == true { enumerator.skipDescendants(); continue }
            if url.pathExtension == "app", values.isDirectory == true {
                apps.append(url)
                enumerator.skipDescendants()
            }
        }
        try require(apps.count == 1 && apps[0].lastPathComponent == "NFD2NFC.app", "Package must contain exactly one NFD2NFC.app")
        app = apps[0]
    } else {
        try require(input.pathExtension == "app", "Expected an app bundle or exported pkg")
    }
    try verifyBundle(app, scratch: scratch)
}

do { try run() }
catch {
    fputs("App icon verification failed: \(error.localizedDescription)\n", stderr)
    exit(1)
}
