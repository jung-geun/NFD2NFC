import Foundation
import Darwin

/// Renames directory entries only; file contents are never opened for writing.
/// Dot-hidden paths are skipped. Packages/bundles are ordinary recursive trees.
/// Explicitly selected roots, and ancestors of other selected roots, remain fixed.
public enum NativeNormalizer {
    public static func normalizedName(_ name: String) -> String {
        guard name.unicodeScalars.contains(where: {
            (0x1100...0x11ff).contains($0.value) ||
            (0xa960...0xa97f).contains($0.value) ||
            (0xd7b0...0xd7ff).contains($0.value)
        }) else { return name }
        return name.precomposedStringWithCanonicalMapping
    }

    public static func normalizeTree(
        at url: URL, rootID: UUID? = nil,
        protectedRoots: [URL] = [], exclusions: [RevertedName] = [],
        onBatch: (ConversionBatch) -> Void
    ) -> URL {
        var batch = ConversionBatch()
        let requestedPath = url.standardizedFileURL.path
        var finalPath = requestedPath
        do {
            let path = try canonicalPath(requestedPath)
            finalPath = path
            let root = try AuthorizedDirectory(path: path)
            let protectedPaths = protectedRoots.map {
                (try? canonicalPath($0.standardizedFileURL.path, allowMissing: true)) ?? $0.standardizedFileURL.path
            }
            normalizeRoot(root, rootID: rootID, protectedPaths: protectedPaths,
                          exclusions: exclusions, batch: &batch, onBatch: onBatch)
        } catch { appendIssue(error, path: requestedPath, rootID: rootID, batch: &batch) }
        if !batch.records.isEmpty || !batch.issues.isEmpty { onBatch(batch) }
        return fileURL(finalPath)
    }

    /// The caller holds the selected root's security scope for the entire call.
    public static func revert(_ record: ConversionRecord, root: URL) throws -> ConversionRecord {
        let authorized = try AuthorizedDirectory(path: canonicalPath(root.standardizedFileURL.path))
        return try revert(record, root: authorized)
    }

    static func revert(_ record: ConversionRecord, root: AuthorizedDirectory) throws -> ConversionRecord {
        guard record.kind == .rename, !record.reverted, let identity = record.identity else {
            throw NativeFileError("이 기록은 되돌릴 수 없습니다.")
        }
        try root.validate()
        let currentParent = parent(record.currentPath)
        // Ancestors may have been renamed; restore the original basename in the
        // rebased current parent, never the stale original parent path.
        let directory = try openDirectory(currentParent, relativeTo: root)
        defer { close(directory) }
        let source = try actualName(in: directory, requested: basename(record.currentPath))
        let sourceInfo = try info(directory, source)
        guard sourceInfo.identity == identity, !sourceInfo.isSymlink,
              sourceInfo.isDirectory == record.isDirectory else {
            throw NativeFileError("변환 후 항목이 달라져서 되돌리지 않았습니다.")
        }
        let destination = basename(record.originalPath)
        guard destination != ".", destination != "..", !destination.isEmpty,
              !rawEqual(source, destination) else {
            throw NativeFileError("기록된 이름 변경을 더 이상 되돌릴 수 없습니다.")
        }
        try move(directory, source: source, destination: destination, expected: identity)
        var reverted = record
        reverted.currentPath = join(currentParent, destination)
        reverted.reverted = true
        return reverted
    }
    @discardableResult
    static func normalizePath(
        _ requestedPath: String, root: AuthorizedDirectory, rootID: UUID?, recursive: Bool,
        protectedPaths: [String], exclusions: [RevertedName], batch: inout ConversionBatch,
        onBatch: (ConversionBatch) -> Void, isActive: () -> Bool = { true }
    ) -> String {
        guard isActive(), contains(root.path, requestedPath), !isHiddenPath(requestedPath) else { return requestedPath }
        if requestedPath == root.path {
            if recursive {
                normalizeRoot(root, rootID: rootID, protectedPaths: protectedPaths,
                              exclusions: exclusions, batch: &batch, onBatch: onBatch, isActive: isActive)
            }
            return root.path
        }
        do {
            try root.validate()
            let parentPath = parent(requestedPath)
            let descriptor = try openDirectory(parentPath, relativeTo: root)
            defer { close(descriptor) }
            let name = try actualName(in: descriptor, requested: basename(requestedPath))
            return try visit(descriptor, name: name, parentPath: parentPath, rootID: rootID,
                             recursive: recursive, protectedPaths: protectedPaths,
                             exclusions: exclusions, batch: &batch, onBatch: onBatch, isActive: isActive)
        } catch {
            if (error as? POSIXFailure)?.code != ENOENT {
                appendIssue(error, path: requestedPath, rootID: rootID, batch: &batch)
                flushIfNeeded(&batch, onBatch: onBatch)
            }
            return requestedPath
        }
    }

    static func normalizeRoot(_ root: AuthorizedDirectory, rootID: UUID?, protectedPaths: [String],
                              exclusions: [RevertedName], batch: inout ConversionBatch,
                              onBatch: (ConversionBatch) -> Void, isActive: () -> Bool = { true }) {
        guard isActive(), !isHiddenPath(root.path) else { return }
        do {
            try root.validate()
            try walk(root.descriptor, path: root.path, rootID: rootID, protectedPaths: protectedPaths,
                     exclusions: exclusions, batch: &batch, onBatch: onBatch, isActive: isActive)
        } catch {
            appendIssue(error, path: root.path, rootID: rootID, batch: &batch)
            flushIfNeeded(&batch, onBatch: onBatch)
        }
    }


    private static func walk(_ descriptor: Int32, path: String, rootID: UUID?,
                             protectedPaths: [String], exclusions: [RevertedName],
                             batch: inout ConversionBatch, onBatch: (ConversionBatch) -> Void,
                             isActive: () -> Bool) throws {
        for name in try names(descriptor) {
            guard isActive() else { return }
            do {
                _ = try visit(descriptor, name: name, parentPath: path, rootID: rootID,
                              recursive: true, protectedPaths: protectedPaths,
                              exclusions: exclusions, batch: &batch, onBatch: onBatch, isActive: isActive)
            } catch {
                if (error as? POSIXFailure)?.code != ENOENT {
                    appendIssue(error, path: join(path, name), rootID: rootID, batch: &batch)
                    flushIfNeeded(&batch, onBatch: onBatch)
                }
            }
        }
    }

    private static func visit(_ descriptor: Int32, name: String, parentPath: String,
                              rootID: UUID?, recursive: Bool,
                              protectedPaths: [String], exclusions: [RevertedName],
                              batch: inout ConversionBatch, onBatch: (ConversionBatch) -> Void,
                              isActive: () -> Bool) throws -> String {
        let path = join(parentPath, name)
        let entry = try info(descriptor, name)
        guard !entry.isSymlink, !isIgnored(name: name) else { return path }
        if recursive && entry.isDirectory {
            let child = name.withCString { openat(descriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC) }
            guard child >= 0 else { throw POSIXFailure("하위 폴더 열기", code: errno) }
            defer { close(child) }
            var opened = stat()
            guard fstat(child, &opened) == 0 else { throw POSIXFailure("폴더 식별 정보 확인", code: errno) }
            guard identity(opened) == entry.identity else { throw NativeFileError("탐색 중 폴더가 다른 항목으로 바뀌었습니다.") }
            try walk(child, path: path, rootID: rootID, protectedPaths: protectedPaths,
                     exclusions: exclusions, batch: &batch, onBatch: onBatch, isActive: isActive)
        }
        guard isActive(), !protectedPaths.contains(where: { contains(path, $0) }) else { return path }
        let normalized = normalizedName(name)
        guard !rawEqual(name, normalized) else { return path }
        guard !exclusions.contains(where: {
            $0.identity == entry.identity && rawEqual($0.name, name) && ($0.rootID == nil || $0.rootID == rootID)
        }) else { return path }
        try move(descriptor, source: name, destination: normalized, expected: entry.identity)
        let newPath = join(parentPath, normalized)
        rebase(&batch.records, from: path, to: newPath)
        batch.records.append(ConversionRecord(rootID: rootID, originalPath: path, currentPath: newPath,
                                              isDirectory: entry.isDirectory, identity: entry.identity))
        flushIfNeeded(&batch, onBatch: onBatch)
        return newPath
    }

    /// Foundation's resolvingSymlinksInPath can strip /private again on macOS.
    /// realpath gives the same symlink-free absolute root spelling as FSEvents.
    /// Missing selected roots retain a canonical existing ancestor for protection;
    /// their subsequent scan still reports the real missing/unavailable error.
    static func canonicalPath(_ path: String, allowMissing: Bool = false) throws -> String {
        if let resolved = path.withCString({ realpath($0, nil) }) {
            defer { free(resolved) }
            return String(cString: resolved)
        }
        let code = errno
        if allowMissing, (code == ENOENT || code == ENOTDIR), path != "/" {
            return join(try canonicalPath(parent(path), allowMissing: true), basename(path))
        }
        throw POSIXFailure("선택한 폴더의 실제 경로 확인", code: code)
    }

    /// Open only an explicitly authorized directory, never its absolute ancestors.
    static func openDirectory(_ path: String) throws -> Int32 {
        let descriptor = path.withCString { open($0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC) }
        guard descriptor >= 0 else { throw POSIXFailure("폴더 열기: \(path)", code: errno) }
        return descriptor
    }

    /// Every event/undo path is opened relative to a retained selected-root fd.
    /// O_NOFOLLOW applies at each component below that boundary, preventing a
    /// replaced intermediate symlink from escaping the authorized directory.
    private static func openDirectory(_ path: String, relativeTo root: AuthorizedDirectory) throws -> Int32 {
        guard contains(root.path, path) else { throw NativeFileError("선택한 폴더 밖의 항목에는 접근하지 않습니다.") }
        let components = path.split(separator: "/").dropFirst(root.path.split(separator: "/").count)
        var descriptor = fcntl(root.descriptor, F_DUPFD_CLOEXEC, 0)
        guard descriptor >= 0 else { throw POSIXFailure("선택한 폴더 접근", code: errno) }
        for component in components {
            guard component != ".", component != ".." else {
                close(descriptor)
                throw NativeFileError("안전하지 않은 상대 경로에는 접근하지 않습니다.")
            }
            let next = String(component).withCString {
                openat(descriptor, $0, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
            }
            let code = errno
            close(descriptor)
            guard next >= 0 else { throw POSIXFailure("하위 폴더 열기: \(path)", code: code) }
            descriptor = next
        }
        return descriptor
    }

    struct EntryInfo {
        var identity: FileIdentity
        var isDirectory: Bool
        var isSymlink: Bool
    }

    static func info(_ descriptor: Int32, _ name: String) throws -> EntryInfo {
        var value = stat()
        let status = name.withCString { fstatat(descriptor, $0, &value, AT_SYMLINK_NOFOLLOW) }
        guard status == 0 else { throw POSIXFailure("항목 정보 확인: \(name)", code: errno) }
        return EntryInfo(identity: identity(value), isDirectory: value.st_mode & S_IFMT == S_IFDIR,
                         isSymlink: value.st_mode & S_IFMT == S_IFLNK)
    }

    static func identity(_ value: stat) -> FileIdentity {
        FileIdentity(device: UInt64(UInt32(bitPattern: value.st_dev)), inode: UInt64(value.st_ino))
    }

    static func names(_ descriptor: Int32) throws -> [String] {
        // dup shares directory offsets. A new description ensures every listing
        // starts at the beginning, including successive FSEvents parent lookups.
        let copy = openat(descriptor, ".", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
        guard copy >= 0 else { throw POSIXFailure("폴더 목록 열기", code: errno) }
        guard let directory = fdopendir(copy) else {
            let code = errno
            close(copy)
            throw POSIXFailure("폴더 목록 읽기", code: code)
        }
        defer { closedir(directory) }
        var result: [String] = []
        while true {
            errno = 0
            guard let entry = readdir(directory) else {
                if errno != 0 { throw POSIXFailure("폴더 항목 읽기", code: errno) }
                break
            }
            let length = Int(entry.pointee.d_namlen)
            let name: String? = withUnsafePointer(to: &entry.pointee.d_name) { pointer in
                pointer.withMemoryRebound(to: UInt8.self, capacity: length) {
                    String(bytes: UnsafeBufferPointer(start: $0, count: length), encoding: .utf8)
                }
            }
            guard let name else { throw NativeFileError("UTF-8로 읽을 수 없는 파일 이름은 변경하지 않습니다.") }
            if name != "." && name != ".." { result.append(name) }
        }
        return result.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
    }

    static func actualName(in descriptor: Int32, requested: String) throws -> String {
        let entries = try names(descriptor)
        if let exact = entries.first(where: { rawEqual($0, requested) }) { return exact }
        // Only accept an equivalent spelling if the filesystem resolves it to the
        // same identity. On case-sensitive/normalization-sensitive volumes it may not.
        let requestedInfo = try info(descriptor, requested)
        if let match = entries.first(where: {
            $0 == requested && (try? info(descriptor, $0).identity) == requestedInfo.identity
        }) { return match }
        throw POSIXFailure("실제 파일 이름 확인", code: ENOENT)
    }

    /// Exclusive staging handles APFS's normalization-insensitive lookup without
    /// permitting rename(2) to overwrite another entry. It also captures the source
    /// before verifying identity, so undo never moves a replacement inode onward.
    private static func move(_ descriptor: Int32, source: String, destination: String,
                             expected: FileIdentity) throws {
        if let target = try? info(descriptor, destination), target.identity != expected {
            throw NativeFileError("대상 이름이 이미 사용 중이어서 변경하지 않았습니다. 기존 항목은 덮어쓰지 않습니다.")
        }
        let staging = ".nfd2nfc-\(UUID().uuidString)"
        try exclusiveRename(descriptor, source, staging)
        do {
            guard try info(descriptor, staging).identity == expected else {
                throw NativeFileError("이름 변경 중 항목이 다른 파일로 바뀌어서 변경하지 않았습니다.")
            }
            try exclusiveRename(descriptor, staging, destination)
        } catch {
            do { try exclusiveRename(descriptor, staging, source) }
            catch let rollbackError {
                throw NativeFileError("이름 변경과 복원이 모두 차단되었습니다. 원래 항목은 임시 이름 \(staging)에 보존되어 있습니다. \(rollbackError.localizedDescription)")
            }
            throw error
        }
    }

    private static func exclusiveRename(_ descriptor: Int32, _ source: String, _ destination: String) throws {
        let status = source.withCString { old in
            destination.withCString { new in
                renameatx_np(descriptor, old, descriptor, new, UInt32(RENAME_EXCL))
            }
        }
        guard status == 0 else { throw POSIXFailure("이름 변경: \(source) → \(destination)", code: errno) }
    }

    // fileURLWithPath decomposes Unicode on macOS, including already-NFC names.
    // Component-based URLs retain the realpath/readdir spelling used by records.
    static func fileURL(_ path: String) -> URL {
        var components = URLComponents()
        components.scheme = "file"
        components.path = path
        return components.url!
    }

    static func rawEqual(_ a: String, _ b: String) -> Bool { a.utf8.elementsEqual(b.utf8) }
    static func parent(_ path: String) -> String { (path as NSString).deletingLastPathComponent }
    static func basename(_ path: String) -> String { (path as NSString).lastPathComponent }
    static func join(_ path: String, _ name: String) -> String { path == "/" ? "/" + name : path + "/" + name }
    static func contains(_ ancestor: String, _ path: String) -> Bool {
        let a = ancestor.split(separator: "/")
        let b = path.split(separator: "/")
        return a.count <= b.count && zip(a, b).allSatisfy { $0 == $1 }
    }

    static func rebase(_ records: inout [ConversionRecord], from old: String, to new: String) {
        let oldCount = old.split(separator: "/").count
        for index in records.indices where contains(old, records[index].currentPath) {
            let suffix = records[index].currentPath.split(separator: "/").dropFirst(oldCount).joined(separator: "/")
            records[index].currentPath = suffix.isEmpty ? new : join(new, suffix)
        }
    }

    static func isIgnored(name: String) -> Bool { name.hasPrefix(".") }
    static func isHiddenPath(_ path: String) -> Bool {
        path.split(separator: "/").contains { $0.hasPrefix(".") }
    }

    /// Previously emitted children are rebased by the caller when a later parent
    /// record arrives. Only this bounded working batch needs local rebasing.
    static func flushIfNeeded(_ batch: inout ConversionBatch, onBatch: (ConversionBatch) -> Void) {
        guard batch.records.count + batch.issues.count >= 128 else { return }
        let ready = batch
        batch = ConversionBatch()
        onBatch(ready)
    }

    static func appendIssue(_ error: Error, path: String, rootID: UUID?, batch: inout ConversionBatch) {
        batch.issues.append(MonitorIssue(rootID: rootID, path: path, message: error.localizedDescription))
    }
}

/// A selected, authorized directory is opened exactly once and retained until its
/// queued work has drained. No parent-directory grants are assumed or requested.
final class AuthorizedDirectory {
    let path: String
    let descriptor: Int32
    let identity: FileIdentity

    init(path: String) throws {
        let descriptor = try NativeNormalizer.openDirectory(path)
        var value = stat()
        guard fstat(descriptor, &value) == 0 else {
            let code = errno
            close(descriptor)
            throw POSIXFailure("선택한 폴더 정보 확인", code: code)
        }
        self.path = path
        self.descriptor = descriptor
        self.identity = NativeNormalizer.identity(value)
    }

    func validate() throws {
        var value = stat()
        guard path.withCString({ lstat($0, &value) }) == 0 else {
            throw POSIXFailure("선택한 폴더 상태 확인", code: errno)
        }
        guard value.st_mode & S_IFMT == S_IFDIR, NativeNormalizer.identity(value) == identity else {
            throw NativeFileError("선택한 폴더가 이동되거나 다른 항목으로 바뀌었습니다. 폴더를 다시 추가해 주세요.")
        }
    }

    deinit { close(descriptor) }
}

struct NativeFileError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

struct POSIXFailure: LocalizedError {
    let operation: String
    let code: Int32
    init(_ operation: String, code: Int32) { self.operation = operation; self.code = code }
    var errorDescription: String? {
        let reason: String
        switch code {
        case EACCES, EPERM: reason = "접근 권한이 없습니다. 폴더를 다시 추가해 주세요."
        case ENOENT: reason = "항목을 찾을 수 없습니다."
        case EEXIST, ENOTEMPTY: reason = "같은 이름의 항목이 이미 있습니다. 기존 항목은 덮어쓰지 않습니다."
        case ELOOP: reason = "심볼릭 링크를 따라가지 않습니다."
        case ENOTDIR: reason = "경로의 항목이 폴더가 아닙니다."
        case EROFS: reason = "읽기 전용 저장 장치입니다."
        case ENOSPC, EDQUOT: reason = "사용할 수 있는 저장 공간이 부족합니다."
        case EBUSY: reason = "항목이 사용 중입니다."
        case EXDEV: reason = "서로 다른 파일 시스템 사이에서는 이름을 변경할 수 없습니다."
        default: reason = "파일 시스템 오류가 발생했습니다. (오류 코드: \(code))"
        }
        return "\(operation): \(reason)"
    }
}
