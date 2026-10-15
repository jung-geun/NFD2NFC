// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NormalizationCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "NormalizationCore", targets: ["NormalizationCore"])],
    targets: [
        .target(name: "NormalizationCore"),
        .testTarget(name: "NormalizationCoreTests", dependencies: ["NormalizationCore"])
    ]
)
