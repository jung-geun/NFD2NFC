import XCTest
import Foundation
import Darwin
@testable import NormalizationCore

final class NativeNormalizerTests: XCTestCase {
    private let decomposed = "\u{1100}\u{1161}"
    private let composed = "\u{ac00}"
    private var sandbox: URL!

    override func setUpWithError() throws {
        sandbox = URL(fileURLWithPath: try NativeNormalizer.canonicalPath(FileManager.default.temporaryDirectory.path))
            .appendingPathComponent("NativeNormalizerTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: false)
    }

    override func tearDownWithError() throws {
        if let sandbox { try FileManager.default.removeItem(at: sandbox) }
    }

    func testHangulFilterUsesRawBytesAndPreservesLatinOnlyNFD() {
        let latin = "e\u{301}"
        XCTAssertEqual(bytes(NativeNormalizer.normalizedName(latin)), bytes(latin))
        XCTAssertEqual(bytes(NativeNormalizer.normalizedName(composed)), bytes(composed))
        XCTAssertEqual(bytes(NativeNormalizer.normalizedName(decomposed)), bytes(composed))
        XCTAssertEqual(bytes(NativeNormalizer.normalizedName(decomposed + latin)), bytes(composed + "é"))
        XCTAssertEqual(bytes(NativeNormalizer.normalizedName("\u{a960}")), bytes("\u{a960}"))
        // Swift String equality alone cannot detect this required rename.
        XCTAssertEqual(decomposed, composed)
        XCTAssertNotEqual(bytes(decomposed), bytes(composed))
    }

    func testActualDirectoryEntryChangesOnceWithoutChangingIdentityOrContents() throws {
        let path = child(decomposed + ".txt")
        let payload = Data([0, 255, 1, 10, 13, 0, 128])
        try write(payload, to: path)
        let before = try identity(path)
        XCTAssertTrue(try rawNames(sandbox.path).contains(bytes(decomposed + ".txt")))
        var received: [ConversionBatch] = []
        NativeNormalizer.normalizeTree(at: sandbox) { received.append($0) }
        XCTAssertEqual(received.count, 1)
        XCTAssertTrue(received[0].issues.isEmpty)
        XCTAssertEqual(received[0].records.count, 1)
        let current = child(composed + ".txt")
        XCTAssertEqual(try identity(current), before)
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: current)), payload)
        XCTAssertTrue(try rawNames(sandbox.path).contains(bytes(composed + ".txt")))
        XCTAssertFalse(try rawNames(sandbox.path).contains(bytes(decomposed + ".txt")))
        NativeNormalizer.normalizeTree(at: sandbox) { _ in XCTFail("Unchanged NFC generated another batch") }
        XCTAssertEqual(try rawNames(sandbox.path).count, 1, "No staging entry should survive success")
    }

    func testBottomUpDirectoryConversionRebasesEveryChildCurrentPath() throws {
        let outer = child(decomposed + "-outer")
        let inner = outer + "/" + decomposed + "-inner"
        try mkdir(outer)
        try mkdir(inner)
        try write(Data("payload".utf8), to: inner + "/" + decomposed + ".txt")
        var records: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: sandbox) {
            XCTAssertTrue($0.issues.isEmpty)
            records += $0.records
        }
        XCTAssertEqual(records.count, 3)
        XCTAssertFalse(records[0].isDirectory)
        XCTAssertTrue(records[1].isDirectory)
        XCTAssertTrue(records[2].isDirectory)
        for record in records {
            XCTAssertEqual(try identity(record.currentPath), record.identity)
            XCTAssertFalse(bytes(record.currentPath).containsSubsequence(bytes(decomposed)))
        }
        // A child can still be undone after both ancestors have changed spelling.
        let reverted = try NativeNormalizer.revert(records[0], root: sandbox)
        XCTAssertTrue(reverted.reverted)
        XCTAssertEqual(try identity(reverted.currentPath), records[0].identity)
        XCTAssertEqual(bytes((reverted.currentPath as NSString).lastPathComponent), bytes(decomposed + ".txt"))
    }

    func testSelectedRootAndAncestorsOfNestedSelectedRootsAreProtected() throws {
        let rootPath = child(decomposed + "-root")
        let ancestor = rootPath + "/" + decomposed + "-ancestor"
        let nested = ancestor + "/" + decomposed + "-selected"
        try mkdir(rootPath)
        try mkdir(ancestor)
        try mkdir(nested)
        try write(Data(), to: nested + "/" + decomposed + ".txt")
        let root = URL(fileURLWithPath: rootPath)
        var records: [ConversionRecord] = []
        let final = NativeNormalizer.normalizeTree(at: root,
            protectedRoots: [root, URL(fileURLWithPath: nested)]) { records += $0.records }
        XCTAssertEqual(bytes(final.path), bytes(rootPath))
        XCTAssertEqual(records.count, 1)
        XCTAssertTrue(try rawNames(rootPath).contains(bytes(decomposed + "-ancestor")))
        XCTAssertTrue(try rawNames(ancestor).contains(bytes(decomposed + "-selected")))
        XCTAssertTrue(try rawNames(nested).contains(bytes(composed + ".txt")))
    }

    func testSelectedRootNameIsNeverChanged() throws {
        let name = decomposed + "-root"
        let root = URL(fileURLWithPath: child(name))
        try mkdir(root.path)
        _ = NativeNormalizer.normalizeTree(at: root) { _ in XCTFail("Selected root renamed") }
        XCTAssertTrue(try rawNames(sandbox.path).contains(bytes(name)))
    }

    func testHiddenPathsAndSymlinksAreSkippedButPackagesRecurseAndRename() throws {
        let outside = child("outside")
        try mkdir(outside)
        let outsideFile = outside + "/" + decomposed + ".txt"
        try write(Data("external".utf8), to: outsideFile)
        let watched = child("watched")
        try mkdir(watched)
        let hidden = watched + "/.hidden"
        let package = watched + "/" + decomposed + ".app"
        try mkdir(hidden)
        try mkdir(package)
        try write(Data(), to: hidden + "/" + decomposed)
        try write(Data(), to: package + "/" + decomposed)
        let link = watched + "/" + decomposed + "-link"
        XCTAssertEqual(outside.withCString { target in link.withCString { symlink(target, $0) } }, 0)
        var records: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: URL(fileURLWithPath: watched)) {
            XCTAssertTrue($0.issues.isEmpty)
            records += $0.records
        }
        XCTAssertEqual(records.count, 2, "Package name and contents follow normal directory rules")
        XCTAssertTrue(try rawNames(watched).contains(bytes(decomposed + "-link")))
        XCTAssertTrue(try rawNames(outside).contains(bytes(decomposed + ".txt")))
        XCTAssertTrue(try rawNames(hidden).contains(bytes(decomposed)))
        XCTAssertTrue(try rawNames(watched).contains(bytes(composed + ".app")))
        XCTAssertTrue(try rawNames(watched + "/" + composed + ".app").contains(bytes(composed)))
        var batch = ConversionBatch()
        let authorized = try AuthorizedDirectory(path: watched)
        NativeNormalizer.normalizePath(link + "/" + decomposed + ".txt", root: authorized, rootID: nil,
                                       recursive: false, protectedPaths: [], exclusions: [], batch: &batch,
                                       onBatch: { _ in XCTFail("Unexpected chunk") })
        XCTAssertTrue(batch.records.isEmpty)
        XCTAssertFalse(batch.issues.isEmpty, "Intermediate symlink must be refused")
        XCTAssertTrue(try rawNames(outside).contains(bytes(decomposed + ".txt")))
    }

    func testUndoRejectsDifferentInodeAndLeavesBothFilesIntact() throws {
        try write(Data("original".utf8), to: child(decomposed))
        var record: ConversionRecord?
        NativeNormalizer.normalizeTree(at: sandbox) { record = $0.records.first }
        let saved = try XCTUnwrap(record)
        let held = child("held-original")
        XCTAssertEqual(saved.currentPath.withCString { old in held.withCString { Darwin.rename(old, $0) } }, 0)
        try write(Data("replacement".utf8), to: saved.currentPath)
        XCTAssertThrowsError(try NativeNormalizer.revert(saved, root: sandbox))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: held)), Data("original".utf8))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: saved.currentPath)), Data("replacement".utf8))
    }

    func testUndoNeverClobbersDifferentInodeOrDistinctHardLink() throws {
        let source = child("current")
        let occupied = child("occupied")
        try write(Data("source".utf8), to: source)
        try write(Data("destination".utf8), to: occupied)
        let record = ConversionRecord(rootID: nil, originalPath: occupied, currentPath: source,
                                      isDirectory: false, identity: try identity(source))
        XCTAssertThrowsError(try NativeNormalizer.revert(record, root: sandbox))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: occupied)), Data("destination".utf8))
        try FileManager.default.removeItem(atPath: occupied)
        XCTAssertEqual(source.withCString { old in occupied.withCString { Darwin.link(old, $0) } }, 0)
        XCTAssertThrowsError(try NativeNormalizer.revert(record, root: sandbox), "Same inode does not make a distinct hard link safe to replace")
        XCTAssertEqual(try rawNames(sandbox.path).count, 2)
        XCTAssertEqual(try identity(source), try identity(occupied))
    }

    func testUndoNameExclusionSurvivesCodablePersistenceAndDoesNotSuppressNewName() throws {
        try write(Data(), to: child(decomposed))
        let rootID = UUID()
        var records: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: sandbox, rootID: rootID) { records += $0.records }
        let reverted = try NativeNormalizer.revert(try XCTUnwrap(records.first), root: sandbox)
        let exclusions = [RevertedName(identity: try XCTUnwrap(reverted.identity), name: decomposed, rootID: rootID)]
        let restored = try JSONDecoder().decode([RevertedName].self, from: JSONEncoder().encode(exclusions))
        NativeNormalizer.normalizeTree(at: sandbox, rootID: rootID, exclusions: restored) { _ in XCTFail("Undo was immediately normalized") }
        XCTAssertTrue(try rawNames(sandbox.path).contains(bytes(decomposed)))
        let newName = child(decomposed + "-new")
        XCTAssertEqual(reverted.currentPath.withCString { old in newName.withCString { Darwin.rename(old, $0) } }, 0)
        var newRecords: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: sandbox, rootID: rootID, exclusions: restored) { newRecords += $0.records }
        XCTAssertEqual(newRecords.count, 1, "Exclusion is identity AND exact name, not identity forever")
    }

    func testSelectedRootNeedsNoReadableAncestorAndUndoStaysWithinThatRoot() throws {
        if geteuid() == 0 { throw XCTSkip("Superuser bypasses directory permission checks") }
        let ancestor = child("search-only-ancestor")
        let selected = ancestor + "/selected"
        try mkdir(ancestor)
        try mkdir(selected)
        try write(Data("payload".utf8), to: selected + "/" + decomposed)
        XCTAssertEqual(ancestor.withCString { chmod($0, 0o111) }, 0)
        defer { _ = ancestor.withCString { chmod($0, 0o700) } }
        let root = URL(fileURLWithPath: selected)
        var records: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: root) {
            XCTAssertTrue($0.issues.isEmpty)
            records += $0.records
        }
        XCTAssertEqual(records.count, 1)
        let reverted = try NativeNormalizer.revert(try XCTUnwrap(records.first), root: root)
        XCTAssertTrue(reverted.reverted)
        XCTAssertTrue(try rawNames(selected).contains(bytes(decomposed)))
    }

    func testUndoRefusesARecordOutsideItsAuthorizedRoot() throws {
        let selected = child("selected")
        try mkdir(selected)
        let outside = child("outside")
        try write(Data("unchanged".utf8), to: outside)
        let record = ConversionRecord(rootID: nil, originalPath: child("old"), currentPath: outside,
                                      isDirectory: false, identity: try identity(outside))
        XCTAssertThrowsError(try NativeNormalizer.revert(record, root: URL(fileURLWithPath: selected)))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: outside)), Data("unchanged".utf8))
    }

    func testLargeTreeEmitsBoundedChunksBeforeParentRename() throws {
        let directory = child(decomposed + "-directory")
        try mkdir(directory)
        for index in 0..<300 {
            try write(Data(), to: directory + "/" + decomposed + "-\(index)")
        }
        var history: [ConversionRecord] = []
        var sizes: [Int] = []
        NativeNormalizer.normalizeTree(at: sandbox) { batch in
            XCTAssertTrue(batch.issues.isEmpty)
            XCTAssertLessThanOrEqual(batch.records.count + batch.issues.count, 128)
            sizes.append(batch.records.count)
            for record in batch.records {
                XCTAssertEqual(try? identity(record.currentPath), record.identity)
                if record.isDirectory {
                    NativeNormalizer.rebase(&history, from: record.originalPath, to: record.currentPath)
                }
            }
            history += batch.records
        }
        XCTAssertEqual(sizes, [128, 128, 45])
        XCTAssertEqual(history.count, 301)
        XCTAssertTrue(history.last?.isDirectory == true)
        for record in history { XCTAssertEqual(try identity(record.currentPath), record.identity) }
    }

    func testExplicitRootAliasCanonicalizesBeforeNoFollowTraversal() throws {
        let real = child("real")
        let alias = child("alias")
        try mkdir(real)
        try mkdir(real + "/selected")
        XCTAssertEqual(real.withCString { target in alias.withCString { symlink(target, $0) } }, 0)
        try write(Data(), to: real + "/selected/" + decomposed)
        var records: [ConversionRecord] = []
        NativeNormalizer.normalizeTree(at: URL(fileURLWithPath: alias + "/selected")) {
            XCTAssertTrue($0.issues.isEmpty)
            records += $0.records
        }
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(bytes(records.first?.currentPath ?? ""), bytes(real + "/selected/" + composed))
        XCTAssertTrue(try rawNames(real + "/selected").contains(bytes(composed)))
    }

    func testMissingExplicitRootReportsAnIssue() {
        var batches: [ConversionBatch] = []
        NativeNormalizer.normalizeTree(at: sandbox.appendingPathComponent("missing")) { batches.append($0) }
        XCTAssertEqual(batches.count, 1)
        XCTAssertEqual(batches.first?.issues.count, 1)
    }

    private func child(_ name: String) -> String { sandbox.path + "/" + name }
    private func bytes(_ value: String) -> [UInt8] { Array(value.utf8) }
    private func mkdir(_ path: String) throws {
        guard path.withCString({ Darwin.mkdir($0, 0o700) }) == 0 else { throw POSIXFailure("Test mkdir", code: errno) }
    }
    private func write(_ data: Data, to path: String) throws {
        let descriptor = path.withCString { Darwin.open($0, O_WRONLY | O_CREAT | O_EXCL, 0o600) }
        guard descriptor >= 0 else { throw POSIXFailure("Test create", code: errno) }
        defer { Darwin.close(descriptor) }
        try data.withUnsafeBytes { buffer in
            var offset = 0
            while offset < buffer.count {
                let count = Darwin.write(descriptor, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
                guard count > 0 else { throw POSIXFailure("Test write", code: errno) }
                offset += count
            }
        }
    }
    private func identity(_ path: String) throws -> FileIdentity {
        var value = stat()
        guard path.withCString({ lstat($0, &value) }) == 0 else { throw POSIXFailure("Test lstat", code: errno) }
        return FileIdentity(device: UInt64(UInt32(bitPattern: value.st_dev)), inode: UInt64(value.st_ino))
    }
    private func rawNames(_ path: String) throws -> [[UInt8]] {
        guard let directory = path.withCString({ opendir($0) }) else { throw POSIXFailure("Test opendir", code: errno) }
        defer { closedir(directory) }
        var result: [[UInt8]] = []
        while let entry = readdir(directory) {
            let count = Int(entry.pointee.d_namlen)
            let bytes = withUnsafePointer(to: &entry.pointee.d_name) {
                $0.withMemoryRebound(to: UInt8.self, capacity: count) { Array(UnsafeBufferPointer(start: $0, count: count)) }
            }
            if bytes != [46] && bytes != [46, 46] { result.append(bytes) }
        }
        return result
    }
}

private extension Array where Element == UInt8 {
    func containsSubsequence(_ needle: [UInt8]) -> Bool {
        guard !needle.isEmpty, needle.count <= count else { return false }
        return (0...(count - needle.count)).contains { Array(self[$0..<($0 + needle.count)]) == needle }
    }
}
