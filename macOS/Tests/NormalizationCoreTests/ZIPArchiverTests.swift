import XCTest
import Foundation
import Darwin
@testable import NormalizationCore

final class ZIPArchiverTests: XCTestCase {
    private var sandbox: URL!
    private let manager = FileManager.default

    override func setUpWithError() throws {
        sandbox = manager.temporaryDirectory.resolvingSymlinksInPath()
            .appendingPathComponent("ZIPArchiverTests-\(UUID().uuidString)", isDirectory: true)
        try manager.createDirectory(at: sandbox, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let sandbox { try manager.removeItem(at: sandbox) }
    }

    func testZIPNFCNamesPreserveOriginalNamesAndContentsIncludingPackagesAndEmptyDirectories() throws {
        let root = try folder("가.pages")
        let output = try folder("output")
        try manager.createDirectory(at: root.appendingPathComponent("empty"), withIntermediateDirectories: false)
        let hangul = root.appendingPathComponent("나.txt")
        let latin = root.appendingPathComponent("cafe\u{301}.txt")
        let hidden = root.appendingPathComponent(".hidden")
        try Data("hangul".utf8).write(to: hangul)
        try Data("latin".utf8).write(to: latin)
        try Data("hidden".utf8).write(to: hidden)
        let beforeNames = try sourceNames(root)
        let beforeRoot = try sourceNames(sandbox)
        let result = try ZIPArchiver.createArchive(from: [root], in: output)
        let entries = try readEntries(result.url)
        XCTAssertEqual(Set(entries.map(\.name)), Set([
            Data("가.pages/".utf8), Data("가.pages/empty/".utf8), Data("가.pages/나.txt".utf8),
            Data("가.pages/cafe\u{301}.txt".utf8), Data("가.pages/.hidden".utf8)
        ]))
        XCTAssertEqual(result.entryCount, 5)
        XCTAssertEqual(result.convertedNameCount, 2)
        XCTAssertEqual(result.bytesRead, 17)
        XCTAssertEqual(try sourceNames(root), beforeNames)
        XCTAssertEqual(try sourceNames(sandbox), beforeRoot)
        XCTAssertEqual(try Data(contentsOf: hangul), Data("hangul".utf8))
        XCTAssertEqual(try Data(contentsOf: latin), Data("latin".utf8))
        XCTAssertEqual(try Data(contentsOf: hidden), Data("hidden".utf8))
        try assertIndependentReaderAccepts(result.url)
        let extracted = try unzip(["-p", result.url.path])
        XCTAssertEqual(extracted.count, 17)
        XCTAssertTrue(entries.allSatisfy { $0.flags & 0x0800 != 0 })
    }

    func testZIPDeflateCRCZIP64FieldsAndActualProgress() throws {
        let root = try folder("source")
        let output = try folder("output")
        let repeated = Data(repeating: 65, count: 512 * 1024)
        try repeated.write(to: root.appendingPathComponent("repeated.txt"))
        try Data("123456789".utf8).write(to: root.appendingPathComponent("crc.txt"))
        var progress: [ArchiveProgress] = []
        let result = try ZIPArchiver.createArchive(from: [root], in: output) { progress.append($0) }
        let entries = try readEntries(result.url)
        let repetitiveEntry = try XCTUnwrap(entries.first { $0.name == Data("source/repeated.txt".utf8) })
        let crcEntry = try XCTUnwrap(entries.first { $0.name == Data("source/crc.txt".utf8) })
        XCTAssertEqual(repetitiveEntry.method, 8)
        XCTAssertEqual(repetitiveEntry.size, UInt64(repeated.count))
        XCTAssertLessThan(repetitiveEntry.compressedSize, UInt64(repeated.count / 10))
        XCTAssertEqual(crcEntry.crc, 0xcbf43926)
        XCTAssertEqual(crcEntry.size, 9)
        XCTAssertEqual(result.bytesRead, UInt64(repeated.count + 9))
        XCTAssertEqual(progress.last?.bytesProcessed, result.bytesRead)
        XCTAssertEqual(progress.last?.filesProcessed, 2)
        for (previous, next) in zip(progress, progress.dropFirst()) {
            XCTAssertLessThanOrEqual(previous.bytesProcessed, next.bytesProcessed)
            XCTAssertLessThanOrEqual(previous.filesProcessed, next.filesProcessed)
        }
        let archive = try Data(contentsOf: result.url)
        for entry in entries {
            let local = Int(entry.offset)
            XCTAssertEqual(try number(archive, at: local, width: 4), 0x04034b50)
            XCTAssertEqual(try number(archive, at: local + 18, width: 4), UInt64(UInt32.max))
            XCTAssertEqual(try number(archive, at: local + 22, width: 4), UInt64(UInt32.max))
            let nameLength = Int(try number(archive, at: local + 26, width: 2))
            let extraLength = Int(try number(archive, at: local + 28, width: 2))
            let rawName = archive.subdata(in: (local + 30)..<(local + 30 + nameLength))
            XCTAssertEqual(rawName, entry.name)
            let descriptor = local + 30 + nameLength + extraLength + Int(entry.compressedSize)
            XCTAssertEqual(try number(archive, at: descriptor, width: 4), 0x08074b50)
            XCTAssertEqual(try number(archive, at: descriptor + 4, width: 4), UInt64(entry.crc))
            XCTAssertEqual(try number(archive, at: descriptor + 8, width: 8), entry.compressedSize)
            XCTAssertEqual(try number(archive, at: descriptor + 16, width: 8), entry.size)
        }
        try assertIndependentReaderAccepts(result.url)
        XCTAssertEqual(try unzip(["-p", result.url.path, "source/repeated.txt"]), repeated)
        XCTAssertEqual(try unzip(["-p", result.url.path, "source/crc.txt"]), Data("123456789".utf8))
    }

    func testZIPSameNameAndNormalizationCollisionsAreDeterministicAndLossless() throws {
        let left = try folder("left")
        let right = try folder("right")
        let third = try folder("third")
        let output = try folder("output")
        let a = left.appendingPathComponent("가.txt")
        let b = right.appendingPathComponent("가.txt")
        let c = third.appendingPathComponent("가.txt (2)")
        try Data("left".utf8).write(to: a)
        try Data("right".utf8).write(to: b)
        try Data("third".utf8).write(to: c)
        let first = try ZIPArchiver.createArchive(from: [c, b, a], in: output)
        let second = try ZIPArchiver.createArchive(from: [a, b, c], in: output)
        XCTAssertEqual(try Data(contentsOf: first.url), try Data(contentsOf: second.url))
        let names = try readEntries(first.url).map(\.name)
        XCTAssertEqual(names, [Data("가.txt".utf8), Data("가.txt (2)".utf8), Data("가.txt (2) (2)".utf8)])
        XCTAssertEqual(first.bytesRead, 14)
        try assertIndependentReaderAccepts(first.url)
        XCTAssertEqual(try unzip(["-p", first.url.path]), Data("leftrightthird".utf8))
        XCTAssertEqual(try Data(contentsOf: a), Data("left".utf8))
        XCTAssertEqual(try Data(contentsOf: b), Data("right".utf8))
        XCTAssertEqual(try Data(contentsOf: c), Data("third".utf8))
    }

    func testZIPRetainsAnAlreadyNFCSelectedLatinFilename() throws {
        let output = try folder("output")
        let physicalPath = sandbox.path + "/café.txt"
        let descriptor = Darwin.open(physicalPath, O_WRONLY | O_CREAT | O_EXCL, 0o600)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        guard descriptor >= 0 else { return }
        let payload = Data("Latin NFC filename".utf8)
        let count = payload.withUnsafeBytes { Darwin.write(descriptor, $0.baseAddress, $0.count) }
        Darwin.close(descriptor)
        XCTAssertEqual(count, payload.count)
        let result = try ZIPArchiver.createArchive(from: [URL(fileURLWithPath: physicalPath)], in: output)
        XCTAssertEqual(try readEntries(result.url).map(\.name), [Data("café.txt".utf8)])
        XCTAssertEqual(try unzip(["-p", result.url.path]), payload)
        XCTAssertTrue(try sourceNames(sandbox).contains(Data("café.txt".utf8)))
    }

    func testZIPPreservesDistinctHardlinkNamesAndModificationDates() throws {
        let output = try folder("output")
        let first = sandbox.appendingPathComponent("first.txt")
        let second = sandbox.appendingPathComponent("second.txt")
        let payload = Data("shared inode, distinct selected names".utf8)
        try payload.write(to: first)
        XCTAssertEqual(Darwin.link(first.path, second.path), 0)
        let modified = Date(timeIntervalSince1970: 1_700_000_000)
        try manager.setAttributes([.modificationDate: modified], ofItemAtPath: first.path)
        let result = try ZIPArchiver.createArchive(from: [second, first], in: output)
        XCTAssertEqual(try readEntries(result.url).map(\.name), [Data("first.txt".utf8), Data("second.txt".utf8)])
        let extracted = try folder("extracted")
        _ = try unzip(["-q", result.url.path, "-d", extracted.path])
        for name in ["first.txt", "second.txt"] {
            let file = extracted.appendingPathComponent(name)
            XCTAssertEqual(try Data(contentsOf: file), payload)
            let date = try XCTUnwrap(manager.attributesOfItem(atPath: file.path)[.modificationDate] as? Date)
            XCTAssertEqual(date.timeIntervalSince1970, modified.timeIntervalSince1970, accuracy: 2)
        }
    }

    func testZIPUnresolvedTemporaryPathsAndSelectedAliasAncestorsAreSupported() throws {
        // Do not resolve /var/folders: this is the URL Foundation hands callers.
        let temporary = manager.temporaryDirectory
            .appendingPathComponent("ZIPArchiverAliasTests-\(UUID().uuidString)", isDirectory: true)
        try manager.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }
        let root = temporary.appendingPathComponent("source")
        let output = temporary.appendingPathComponent("output")
        try manager.createDirectory(at: root, withIntermediateDirectories: false)
        try manager.createDirectory(at: output, withIntermediateDirectories: false)
        let file = root.appendingPathComponent("data.txt")
        try Data("alias".utf8).write(to: file)
        let alias = temporary.appendingPathComponent("alias")
        try manager.createSymbolicLink(at: alias, withDestinationURL: root)
        let result = try ZIPArchiver.createArchive(from: [alias.appendingPathComponent("data.txt"), root], in: output)
        XCTAssertEqual(result.entryCount, 2)
        XCTAssertEqual(result.bytesRead, 5)
        XCTAssertEqual(try readEntries(result.url).map(\.name), [Data("source/".utf8), Data("source/data.txt".utf8)])
        try assertIndependentReaderAccepts(result.url)
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [alias], in: output))
    }

    func testZIPCancellationDuringStreamingRemovesPartialArchive() async throws {
        let output = try folder("output")
        let file = sandbox.appendingPathComponent("input.txt")
        let payload = Data(repeating: 65, count: 512 * 1024)
        try payload.write(to: file)
        let task = Task.detached {
            try ZIPArchiver.createArchive(from: [file], in: output) { progress in
                if progress.bytesProcessed > 0 {
                    withUnsafeCurrentTask { $0?.cancel() }
                }
            }
        }
        do {
            _ = try await task.value
            XCTFail("A cancelled archive must not be published")
        } catch is CancellationError {
            // Expected, after at least one real input chunk was processed.
        }
        XCTAssertTrue(try manager.contentsOfDirectory(atPath: output.path).isEmpty)
        XCTAssertEqual(try Data(contentsOf: file), payload)
    }

    func testZIPNestedSelectedSourcesAreIncludedExactlyOnce() throws {
        let root = try folder("root")
        let nested = root.appendingPathComponent("nested")
        try manager.createDirectory(at: nested, withIntermediateDirectories: false)
        let file = nested.appendingPathComponent("data.txt")
        try Data("once".utf8).write(to: file)
        let empty = root.appendingPathComponent("empty")
        try manager.createDirectory(at: empty, withIntermediateDirectories: false)
        let output = try folder("output")
        let result = try ZIPArchiver.createArchive(from: [file, nested, root, root, empty], in: output)
        XCTAssertEqual(result.entryCount, 4)
        XCTAssertEqual(result.bytesRead, 4)
        XCTAssertEqual(Set(try readEntries(result.url).map(\.name)), Set([
            Data("root/".utf8), Data("root/empty/".utf8), Data("root/nested/".utf8), Data("root/nested/data.txt".utf8)
        ]))
        try assertIndependentReaderAccepts(result.url)
    }

    func testZIPOutputInsideSourceIsExcludedAndExistingArchiveIsNeverReplaced() throws {
        let root = try folder("source")
        let output = root.appendingPathComponent("output")
        try manager.createDirectory(at: output, withIntermediateDirectories: false)
        let existing = output.appendingPathComponent("NFD2NFC.zip")
        let existingPartial = output.appendingPathComponent("old.partial")
        let sentinel = Data("do not replace".utf8)
        try sentinel.write(to: existing)
        try sentinel.write(to: existingPartial)
        try Data("source".utf8).write(to: root.appendingPathComponent("data.txt"))
        let result = try ZIPArchiver.createArchive(from: [root], in: output)
        XCTAssertEqual(result.url.lastPathComponent, "NFD2NFC (2).zip")
        XCTAssertEqual(try Data(contentsOf: existing), sentinel)
        XCTAssertEqual(try Data(contentsOf: existingPartial), sentinel)
        XCTAssertEqual(try readEntries(result.url).map(\.name), [Data("source/".utf8), Data("source/data.txt".utf8)])
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: output.path).count, 3)
        try assertIndependentReaderAccepts(result.url)
    }

    func testZIPRejectsSymlinksAndRemovesPartiallyWrittenOutput() throws {
        let root = try folder("source")
        let output = try folder("output")
        let outside = try folder("outside")
        try Data("private".utf8).write(to: outside.appendingPathComponent("secret"))
        try Data(repeating: 65, count: 128 * 1024).write(to: root.appendingPathComponent("a.txt"))
        let link = root.appendingPathComponent("z-link")
        try manager.createSymbolicLink(at: link, withDestinationURL: outside)
        let marker = output.appendingPathComponent("keep.txt")
        try Data("keep".utf8).write(to: marker)
        var bytes: UInt64 = 0
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [root], in: output) { bytes = $0.bytesProcessed })
        XCTAssertGreaterThan(bytes, 0, "Failure must occur after a real partial archive has been written")
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: output.path), ["keep.txt"])
        XCTAssertEqual(try Data(contentsOf: marker), Data("keep".utf8))
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [link], in: output))
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: output.path), ["keep.txt"])
        XCTAssertEqual(try Data(contentsOf: outside.appendingPathComponent("secret")), Data("private".utf8))
    }

    func testZIPRejectsUnsafePathsAndInvalidSourcesWithoutLeavingOutput() throws {
        let output = try folder("output")
        let unsafe = sandbox.appendingPathComponent("unsafe\\name.txt")
        try Data("unchanged".utf8).write(to: unsafe)
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [], in: output))
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [try XCTUnwrap(URL(string: "https://example.com/file"))], in: output))
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [unsafe], in: output))
        XCTAssertThrowsError(try ZIPArchiver.createArchive(from: [output], in: output))
        XCTAssertTrue(try manager.contentsOfDirectory(atPath: output.path).isEmpty)
        XCTAssertEqual(try Data(contentsOf: unsafe), Data("unchanged".utf8))
    }

    func testZIPDestinationCreatedDuringStreamingIsNeverClobbered() throws {
        let output = try folder("output")
        let file = sandbox.appendingPathComponent("input.txt")
        try Data(repeating: 65, count: 128 * 1024).write(to: file)
        let destination = output.appendingPathComponent("NFD2NFC.zip")
        let sentinel = Data("created during compression".utf8)
        var created = false
        var callbackError: Error?
        let result = try ZIPArchiver.createArchive(from: [file], in: output) { progress in
            guard !created, progress.bytesProcessed > 0 else { return }
            created = true
            do { try sentinel.write(to: destination, options: .withoutOverwriting) }
            catch { callbackError = error }
        }
        XCTAssertTrue(created)
        XCTAssertNil(callbackError)
        XCTAssertEqual(result.url.lastPathComponent, "NFD2NFC (2).zip")
        XCTAssertEqual(try Data(contentsOf: destination), sentinel)
        XCTAssertEqual(try manager.contentsOfDirectory(atPath: output.path).count, 2)
        try assertIndependentReaderAccepts(result.url)
    }

    func testZIPExistingDestinationSymlinkIsNotReplacedOrFollowed() throws {
        let output = try folder("output")
        let file = sandbox.appendingPathComponent("input.txt")
        let victim = sandbox.appendingPathComponent("victim.txt")
        try Data("payload".utf8).write(to: file)
        try Data("safe".utf8).write(to: victim)
        let link = output.appendingPathComponent("NFD2NFC.zip")
        try manager.createSymbolicLink(at: link, withDestinationURL: victim)
        let result = try ZIPArchiver.createArchive(from: [file], in: output)
        XCTAssertEqual(result.url.lastPathComponent, "NFD2NFC (2).zip")
        XCTAssertEqual(try manager.destinationOfSymbolicLink(atPath: link.path), victim.path)
        XCTAssertEqual(try Data(contentsOf: victim), Data("safe".utf8))
        try assertIndependentReaderAccepts(result.url)
    }

    func testZIP64EntryCountBeyondZIP32ReopensIndependently() throws {
        let root = try folder("many")
        let output = try folder("output")
        // Real empty files cross the 65535-entry sentinel without artificial writer state.
        for index in 0..<65535 {
            let file = root.appendingPathComponent(String(format: "%05d", index))
            let fd = Darwin.open(file.path, O_WRONLY | O_CREAT | O_EXCL, mode_t(0o600))
            guard fd >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
            Darwin.close(fd)
        }
        var finalProgress: ArchiveProgress?
        let result = try ZIPArchiver.createArchive(from: [root], in: output) { finalProgress = $0 }
        XCTAssertEqual(result.entryCount, 65536)
        XCTAssertEqual(result.bytesRead, 0)
        XCTAssertEqual(finalProgress?.filesProcessed, 65535)
        XCTAssertEqual(finalProgress?.bytesProcessed, 0)
        XCTAssertEqual(try readEntries(result.url).count, 65536)
        let data = try Data(contentsOf: result.url)
        XCTAssertEqual(try number(data, at: data.count - 12, width: 2), 65535)
        try assertIndependentReaderAccepts(result.url)
    }

    private func folder(_ name: String) throws -> URL {
        let result = sandbox.appendingPathComponent(name, isDirectory: true)
        try manager.createDirectory(at: result, withIntermediateDirectories: true)
        return result
    }

    private func sourceNames(_ root: URL) throws -> [Data] {
        try manager.contentsOfDirectory(atPath: root.path).map { Data($0.utf8) }.sorted { $0.lexicographicallyPrecedes($1) }
    }

    @discardableResult
    private func unzip(_ arguments: [String], file: StaticString = #filePath, line: UInt = #line) throws -> Data {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["LC_ALL"] = "en_US.UTF-8"
        process.environment = environment
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        XCTAssertEqual(process.terminationStatus, 0, String(decoding: data, as: UTF8.self), file: file, line: line)
        return data
    }

    private func assertIndependentReaderAccepts(_ url: URL, file: StaticString = #filePath, line: UInt = #line) throws {
        try unzip(["-tqq", url.path], file: file, line: line)
    }

    private struct ReadEntry {
        let name: Data
        let flags: UInt16
        let method: UInt16
        let crc: UInt32
        let compressedSize: UInt64
        let size: UInt64
        let offset: UInt64
    }

    /// Inspect raw metadata independently of writer implementation and String normalization.
    private func readEntries(_ url: URL) throws -> [ReadEntry] {
        let data = try Data(contentsOf: url)
        let locator = data.count - 42
        XCTAssertEqual(try number(data, at: data.count - 22, width: 4), 0x06054b50)
        XCTAssertEqual(try number(data, at: locator, width: 4), 0x07064b50)
        let zip64 = Int(try number(data, at: locator + 8, width: 8))
        XCTAssertEqual(try number(data, at: zip64, width: 4), 0x06064b50)
        let count = Int(try number(data, at: zip64 + 32, width: 8))
        var position = Int(try number(data, at: zip64 + 48, width: 8))
        var result: [ReadEntry] = []
        for _ in 0..<count {
            XCTAssertEqual(try number(data, at: position, width: 4), 0x02014b50)
            let nameLength = Int(try number(data, at: position + 28, width: 2))
            let extraLength = Int(try number(data, at: position + 30, width: 2))
            let commentLength = Int(try number(data, at: position + 32, width: 2))
            let nameStart = position + 46
            let extra = nameStart + nameLength
            guard nameStart >= 0, extra <= data.count else { throw corruptArchive() }
            XCTAssertEqual(try number(data, at: position + 20, width: 4), UInt64(UInt32.max))
            XCTAssertEqual(try number(data, at: position + 24, width: 4), UInt64(UInt32.max))
            XCTAssertEqual(try number(data, at: position + 42, width: 4), UInt64(UInt32.max))
            XCTAssertEqual(try number(data, at: extra, width: 2), 1)
            XCTAssertEqual(try number(data, at: extra + 2, width: 2), 24)
            result.append(ReadEntry(
                name: data.subdata(in: nameStart..<extra),
                flags: UInt16(try number(data, at: position + 8, width: 2)),
                method: UInt16(try number(data, at: position + 10, width: 2)),
                crc: UInt32(try number(data, at: position + 16, width: 4)),
                compressedSize: try number(data, at: extra + 12, width: 8),
                size: try number(data, at: extra + 4, width: 8),
                offset: try number(data, at: extra + 20, width: 8)
            ))
            position = extra + extraLength + commentLength
        }
        XCTAssertEqual(position, zip64)
        return result
    }

    private func number(_ data: Data, at offset: Int, width: Int) throws -> UInt64 {
        guard offset >= 0, width > 0, width <= 8, offset <= data.count - width else { throw corruptArchive() }
        var result: UInt64 = 0
        for index in 0..<width { result |= UInt64(data[offset + index]) << (index * 8) }
        return result
    }

    private func corruptArchive() -> NSError {
        NSError(domain: "ZIPArchiverTests.InvalidZIP", code: 1)
    }
}
