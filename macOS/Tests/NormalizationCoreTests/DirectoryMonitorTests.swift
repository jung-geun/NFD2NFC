import XCTest
import Foundation
import Darwin
@testable import NormalizationCore

final class DirectoryMonitorTests: XCTestCase {
    private let nfd = "\u{1100}\u{1161}"
    private let nfc = "\u{ac00}"
    private var sandbox: URL!

    override func setUpWithError() throws {
        sandbox = URL(fileURLWithPath: try NativeNormalizer.canonicalPath(FileManager.default.temporaryDirectory.path))
            .appendingPathComponent("DirectoryMonitorTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: sandbox, withIntermediateDirectories: false)
    }

    override func tearDownWithError() throws {
        if let sandbox { try FileManager.default.removeItem(at: sandbox) }
    }

    func testStartupCollapsesOverlapsProtectsSelectedDirectoriesAndAssignsDeepestOwner() throws {
        let outer = sandbox.appendingPathComponent(nfd + "-outer")
        let nested = outer.appendingPathComponent(nfd + "-selected")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try write(nested.path + "/" + nfd + ".txt")
        let outerID = UUID(), nestedID = UUID()
        let batches = BatchBox()
        let ready = expectation(description: "Startup drained")
        let monitor = DirectoryMonitor { batches.append($0) }
        monitor.setRoots([WatchRoot(id: outerID, url: outer), WatchRoot(id: nestedID, url: nested)], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        monitor.stop()
        let records = batches.all.flatMap(\.records)
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.rootID, nestedID)
        XCTAssertTrue(batches.all.flatMap(\.issues).isEmpty)
        XCTAssertEqual(try names(sandbox.path), [Array((nfd + "-outer").utf8)])
        XCTAssertEqual(try names(outer.path), [Array((nfd + "-selected").utf8)])
        XCTAssertEqual(try names(nested.path), [Array((nfc + ".txt").utf8)])
    }

    func testMovedInSubtreeProducesCoherentBottomUpBatchFromRealEvents() throws {
        let watched = sandbox.appendingPathComponent("watched")
        let staged = sandbox.appendingPathComponent("staged")
        try FileManager.default.createDirectory(at: watched, withIntermediateDirectories: false)
        let ready = expectation(description: "Stream ready")
        let converted = expectation(description: "Moved-in subtree converted")
        let barrier = expectation(description: "Events after conversion echoes delivered")
        let barrierName = nfd + "-barrier"
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if batch.records.count == 3 { converted.fulfill() }
            if batch.records.contains(where: { ($0.originalPath as NSString).lastPathComponent == barrierName }) {
                barrier.fulfill()
            }
        }
        defer { monitor.stop() }
        monitor.setRoots([WatchRoot(id: UUID(), url: watched)], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        try FileManager.default.createDirectory(at: staged.appendingPathComponent(nfd + "-inner"), withIntermediateDirectories: true)
        try write(staged.path + "/" + nfd + "-inner/" + nfd + ".txt")
        let destination = watched.path + "/" + nfd + "-outer"
        XCTAssertEqual(staged.path.withCString { old in destination.withCString { Darwin.rename(old, $0) } }, 0)
        wait(for: [converted], timeout: 10)
        // A later event is a queue barrier: conversion echo event IDs precede it.
        try write(watched.path + "/" + barrierName)
        wait(for: [barrier], timeout: 10)
        monitor.stop()
        let records = batches.all.flatMap(\.records)
        XCTAssertEqual(records.count, 4, "Only the later sentinel may add a conversion; NFC echoes must not reconvert")
        for record in records {
            var value = stat()
            XCTAssertEqual(record.currentPath.withCString { lstat($0, &value) }, 0, "All current paths must be rebased after ancestor renames")
            XCTAssertEqual(UInt64(value.st_ino), record.identity?.inode)
        }
        let final = watched.path + "/" + nfc + "-outer/" + nfc + "-inner"
        XCTAssertEqual(try names(final), [Array((nfc + ".txt").utf8)])
    }

    func testUndoInstallsImmediateSuppressionAndPersistsAcrossMonitorRestart() throws {
        let path = sandbox.path + "/" + nfd
        try write(path)
        let rootID = UUID()
        let root = WatchRoot(id: rootID, url: sandbox)
        let batches = BatchBox()
        let ready = expectation(description: "Initial conversion")
        let barrier = expectation(description: "Events after undo delivered")
        let barrierName = nfd + "-undo-barrier"
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if batch.records.contains(where: { ($0.originalPath as NSString).lastPathComponent == barrierName }) {
                barrier.fulfill()
            }
        }
        defer { monitor.stop() }
        monitor.setRoots([root], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        let record = try XCTUnwrap(batches.all.flatMap(\.records).first)
        let undone = expectation(description: "Undo completed")
        let results = UndoBox()
        monitor.revert(record) { result in
            results.set(result)
            undone.fulfill()
        }
        wait(for: [undone], timeout: 5)
        let reverted = try XCTUnwrap(results.value).get()
        XCTAssertTrue(reverted.reverted)
        let namesToPersist = [RevertedName(identity: try XCTUnwrap(reverted.identity), name: nfd, rootID: rootID)]
        let updated = expectation(description: "Persisted exclusions applied")
        monitor.setRoots([root], exclusions: namesToPersist) { updated.fulfill() }
        wait(for: [updated], timeout: 5)
        // Do not stop the stream before undo events have actually been consumed.
        try write(sandbox.path + "/" + barrierName)
        wait(for: [barrier], timeout: 10)
        monitor.stop()
        XCTAssertEqual(try names(sandbox.path).count, 2)
        XCTAssertTrue(try names(sandbox.path).contains(Array(nfd.utf8)))
        XCTAssertEqual(batches.all.flatMap(\.records).count, 2)

        let persisted = try JSONDecoder().decode([RevertedName].self, from: JSONEncoder().encode(namesToPersist))
        let restartedBatches = BatchBox()
        let restartedReady = expectation(description: "Restarted startup scan")
        let restarted = DirectoryMonitor { restartedBatches.append($0) }
        restarted.setRoots([root], exclusions: persisted) { restartedReady.fulfill() }
        wait(for: [restartedReady], timeout: 5)
        restarted.stop()
        XCTAssertTrue(restartedBatches.all.flatMap(\.records).isEmpty)
        XCTAssertEqual(try names(sandbox.path).count, 2)
        XCTAssertTrue(try names(sandbox.path).contains(Array(nfd.utf8)))
    }

    func testRootReplacementReplaysBufferedEventsForUnchangedRoot() throws {
        let first = sandbox.appendingPathComponent("first")
        let second = sandbox.appendingPathComponent("second")
        try FileManager.default.createDirectory(at: first, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: second, withIntermediateDirectories: false)
        let firstRoot = WatchRoot(id: UUID(), url: first)
        let secondRoot = WatchRoot(id: UUID(), url: second)
        let ready = expectation(description: "First stream ready")
        let replaced = expectation(description: "Roots updated before old stream latency")
        let converted = expectation(description: "Buffered unchanged-root event replayed")
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if !batch.records.isEmpty { converted.fulfill() }
        }
        defer { monitor.stop() }
        monitor.setRoots([firstRoot], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        try write(first.path + "/" + nfd)
        monitor.setRoots([secondRoot, firstRoot], exclusions: []) { replaced.fulfill() }
        wait(for: [replaced, converted], timeout: 10)
        monitor.stop()
        XCTAssertEqual(batches.all.flatMap(\.records).count, 1)
        XCTAssertEqual(batches.all.flatMap(\.records).first?.rootID, firstRoot.id)
        XCTAssertTrue(batches.all.flatMap(\.issues).isEmpty)
        XCTAssertEqual(try names(first.path), [Array(nfc.utf8)])
    }

    func testRootAliasMatchesCanonicalFSEventsPaths() throws {
        let real = sandbox.appendingPathComponent("real")
        let alias = sandbox.appendingPathComponent("alias")
        try FileManager.default.createDirectory(at: real, withIntermediateDirectories: false)
        XCTAssertEqual(real.path.withCString { target in alias.path.withCString { symlink(target, $0) } }, 0)
        let ready = expectation(description: "Canonical root stream ready")
        let converted = expectation(description: "Canonical event matched aliased selected root")
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if !batch.records.isEmpty { converted.fulfill() }
        }
        defer { monitor.stop() }
        let rootID = UUID()
        monitor.setRoots([WatchRoot(id: rootID, url: alias)], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        try write(real.path + "/" + nfd)
        wait(for: [converted], timeout: 10)
        monitor.stop()
        XCTAssertEqual(batches.all.flatMap(\.records).first?.rootID, rootID)
        XCTAssertTrue(batches.all.flatMap(\.issues).isEmpty)
        XCTAssertEqual(try names(real.path), [Array(nfc.utf8)])
    }

    func testMonitorStartupEventsAndUndoDoNotOpenUnreadableAncestors() throws {
        if geteuid() == 0 { throw XCTSkip("Superuser bypasses directory permission checks") }
        let ancestor = sandbox.appendingPathComponent("search-only")
        let selected = ancestor.appendingPathComponent("selected")
        try FileManager.default.createDirectory(at: selected, withIntermediateDirectories: true)
        try write(selected.path + "/" + nfd)
        XCTAssertEqual(ancestor.path.withCString { chmod($0, 0o111) }, 0)
        defer { _ = ancestor.path.withCString { chmod($0, 0o700) } }
        let ready = expectation(description: "Selected-root startup without ancestor reads")
        let event = expectation(description: "Selected-root event without ancestor reads")
        let eventName = nfd + "-event"
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if batch.records.contains(where: { ($0.originalPath as NSString).lastPathComponent == eventName }) {
                event.fulfill()
            }
        }
        defer { monitor.stop() }
        monitor.setRoots([WatchRoot(id: UUID(), url: selected)], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        let initial = try XCTUnwrap(batches.all.flatMap(\.records).first)
        try write(selected.path + "/" + eventName)
        wait(for: [event], timeout: 10)
        let undo = expectation(description: "Root-relative undo without ancestor reads")
        let results = UndoBox()
        monitor.revert(initial) { result in results.set(result); undo.fulfill() }
        wait(for: [undo], timeout: 5)
        XCTAssertTrue(try XCTUnwrap(results.value).get().reverted)
        monitor.stop()
        XCTAssertTrue(batches.all.flatMap(\.issues).isEmpty)
        XCTAssertTrue(try names(selected.path).contains(Array(nfd.utf8)))
    }


    func testSelectedNFCRootPreservesPhysicalPathSpellingInLiveRecords() throws {
        let physicalRoot = sandbox.path + "/선택폴더"
        XCTAssertEqual(Darwin.mkdir(physicalRoot, 0o700), 0)
        let ready = expectation(description: "NFC root started")
        let converted = expectation(description: "Live child converted")
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batch in
            batches.append(batch)
            if !batch.records.isEmpty { converted.fulfill() }
        }
        defer { monitor.stop() }
        monitor.setRoots([WatchRoot(id: UUID(), url: URL(fileURLWithPath: physicalRoot))], exclusions: []) { ready.fulfill() }
        wait(for: [ready], timeout: 5)
        try write(physicalRoot + "/" + nfd)
        wait(for: [converted], timeout: 10)
        monitor.stop()
        let record = try XCTUnwrap(batches.all.flatMap(\.records).first)
        XCTAssertEqual(Array(record.currentPath.utf8), Array((physicalRoot + "/" + nfc).utf8))
        XCTAssertTrue(batches.all.flatMap(\.issues).isEmpty)
        XCTAssertTrue(try names(physicalRoot).contains(Array(nfc.utf8)))
    }

    func testStopDrainsEnqueuedStartupBeforeReturning() throws {
        try write(sandbox.path + "/" + nfd)
        let batches = BatchBox()
        let monitor = DirectoryMonitor { batches.append($0) }
        monitor.setRoots([WatchRoot(id: UUID(), url: sandbox)], exclusions: [])
        monitor.stop()
        XCTAssertEqual(batches.all.flatMap(\.records).count, 1)
        XCTAssertEqual(try names(sandbox.path), [Array(nfc.utf8)])
        // Scope owners can safely release authorization after this synchronous call.
        try write(sandbox.path + "/" + nfd + "-after-stop")
        monitor.stop()
        XCTAssertTrue(try names(sandbox.path).contains(Array((nfd + "-after-stop").utf8)))
    }

    private func write(_ path: String) throws {
        let descriptor = path.withCString { Darwin.open($0, O_CREAT | O_EXCL | O_WRONLY, 0o600) }
        guard descriptor >= 0 else { throw POSIXFailure("Test create", code: errno) }
        close(descriptor)
    }

    private func names(_ path: String) throws -> [[UInt8]] {
        let descriptor = try NativeNormalizer.openDirectory(path)
        defer { close(descriptor) }
        return try NativeNormalizer.names(descriptor).map { Array($0.utf8) }
    }
}

private final class BatchBox: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [ConversionBatch] = []
    func append(_ batch: ConversionBatch) { lock.lock(); defer { lock.unlock() }; storage.append(batch) }
    var all: [ConversionBatch] { lock.lock(); defer { lock.unlock() }; return storage }
}

private final class UndoBox: @unchecked Sendable {
    private let lock = NSLock()
    private var storage: Result<ConversionRecord, Error>?
    func set(_ result: Result<ConversionRecord, Error>) { lock.lock(); defer { lock.unlock() }; storage = result }
    var value: Result<ConversionRecord, Error>? { lock.lock(); defer { lock.unlock() }; return storage }
}
