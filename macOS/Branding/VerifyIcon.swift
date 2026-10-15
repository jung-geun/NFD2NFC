import Foundation
import ImageIO

// Check the actual bundle, not the source PNGs or Assets.car: App Store validation reads ICNS.
func fail(_ message: String) -> Never {
    fputs("App icon verification failed: \(message)\n", stderr)
    exit(1)
}

func bigEndian32(_ data: Data, at offset: Int) -> Int {
    (Int(data[offset]) << 24) | (Int(data[offset + 1]) << 16) | (Int(data[offset + 2]) << 8) | Int(data[offset + 3])
}

guard CommandLine.arguments.count == 2 else { fail("Usage: VerifyIcon.swift <NFD2NFC.app>") }
do {
    let app = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let infoData = try Data(contentsOf: app.appendingPathComponent("Contents/Info.plist"))
    let info = try PropertyListSerialization.propertyList(from: infoData, options: [], format: nil) as? [String: Any]
    guard let name = info?["CFBundleIconFile"] as? String else { fail("CFBundleIconFile is missing") }
    let filename = name.hasSuffix(".icns") ? name : name + ".icns"
    let icon = try Data(contentsOf: app.appendingPathComponent("Contents/Resources/" + filename))
    guard icon.count >= 8, icon.prefix(4).elementsEqual("icns".utf8), bigEndian32(icon, at: 4) == icon.count else {
        fail("\(filename) has an invalid ICNS header")
    }
    var offset = 8
    var found = false
    while offset < icon.count {
        guard icon.count - offset >= 8 else { fail("Truncated ICNS entry") }
        let length = bigEndian32(icon, at: offset + 4)
        guard length >= 8, length <= icon.count - offset else { fail("Invalid ICNS entry length") }
        if icon[offset..<(offset + 4)].elementsEqual("ic10".utf8) {
            let payload = icon.subdata(in: (offset + 8)..<(offset + length))
            guard let source = CGImageSourceCreateWithData(payload as CFData, nil),
                  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = properties[kCGImagePropertyPixelWidth] as? Int,
                  let height = properties[kCGImagePropertyPixelHeight] as? Int,
                  width == 1024, height == 1024 else {
                fail("The 512pt @2x ICNS entry must decode to 1024×1024 pixels")
            }
            found = true
        }
        offset += length
    }
    guard found else { fail("\(filename) has no 512pt @2x entry; set Standalone Icon File Behavior to All and rebuild") }
    print("Verified \(filename): 512pt @2x ICNS image is 1024×1024 pixels")
} catch {
    fail(error.localizedDescription)
}
