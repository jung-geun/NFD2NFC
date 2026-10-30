import Foundation

// Exercise the release gate against real built resources; never launch or register fixtures.
@main
struct BuildVersionSmoke {
    static func main() throws {
        guard CommandLine.arguments.count == 2 else {
            fatalError("Usage: BuildVersionSmoke.swift <built NFD2NFC.app>")
        }
        let builtApp = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
        let macOS = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        let verifier = macOS.appendingPathComponent("Branding/VerifyIcon.swift")
        let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("NFD2NFC-build-version-smoke-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let app = scratch.appendingPathComponent("NFD2NFC.app")
        let contents = app.appendingPathComponent("Contents")
        try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: builtApp.appendingPathComponent("Contents/Resources"),
            to: contents.appendingPathComponent("Resources"))
        let infoData = try Data(contentsOf: builtApp.appendingPathComponent("Contents/Info.plist"))
        guard var info = try PropertyListSerialization.propertyList(from: infoData, options: [], format: nil) as? [String: Any] else {
            fatalError("Built app metadata is invalid")
        }
        // Keep the newer marketing version while checking the independent machine version.
        info["CFBundleShortVersionString"] = "3.0.1"
        for (build, expectedSuccess) in [("2", false), ("2.0.3", false), ("3", true)] {
            info["CFBundleVersion"] = build
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: contents.appendingPathComponent("Info.plist"))
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
            process.arguments = ["swift", verifier.path, app.path]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try process.run()
            process.waitUntilExit()
            let succeeded = process.terminationReason == .exit && process.terminationStatus == 0
            guard succeeded == expectedSuccess else {
                fatalError("Release validation for marketing 3.0.1 / build \(build) unexpectedly \(succeeded ? "passed" : "failed")")
            }
        }
        print("Build-version migration regression passed: native build 2 and legacy boundary 2.0.3 rejected; build 3 and all icon resources accepted")
    }
}
