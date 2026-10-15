import Foundation
import Darwin
import zlib

/// Writes ZIP-internal normalized names only; source entries are opened read-only.
/// Files are raw-DEFLATE streamed; directories (including empty directories and
/// packages) are preserved. ZIP64 metadata and UTF-8 names are always emitted.
/// Source modification times and POSIX modes are retained in the ZIP metadata.
/// Sibling collisions receive deterministic ` (2)` suffixes; nested selections are deduplicated.
/// Selected or descendant symlinks, special files, non-UTF-8 names and unsafe
/// path components fail the operation. Aliases above granted URLs are supported.
/// The dedicated destination directory is excluded from trees. Publication never
/// replaces an existing archive; failures and task cancellation remove the partial.
public enum ZIPArchiver {
    public static func createArchive(
        from sources: [URL],
        in directory: URL,
        progress: (ArchiveProgress) -> Void = { _ in }
    ) throws -> ArchiveResult {
        try checkCancellation()
        guard !sources.isEmpty else { throw ArchiveError.invalid("No archive sources selected") }
        let destination = try openPath(directory, directoryOnly: true)
        defer { Darwin.close(destination.fd) }
        var roots: [Source] = []
        for url in sources {
            try checkCancellation()
            let opened = try openPath(url, directoryOnly: false)
            Darwin.close(opened.fd)
            roots.append(Source(url: url, identity: opened.identity, ancestors: opened.ancestors,
                                canonicalPath: opened.canonicalPath, isDirectory: opened.isDirectory))
        }
        roots.sort { $0.url.path.utf8.lexicographicallyPrecedes($1.url.path.utf8) }
        var seen = Set<Data>()
        roots = roots.filter { seen.insert(Data($0.canonicalPath.utf8)).inserted }
        let directoryIdentities = Set(roots.filter(\.isDirectory).map(\.identity))
        let directoryPaths = Set(roots.filter(\.isDirectory).map { Data($0.canonicalPath.utf8) })
        roots.removeAll { source in
            if source.ancestors.contains(where: { directoryIdentities.contains($0) }) { return true }
            let path = Data(source.canonicalPath.utf8)
            for index in path.indices where index > 0 && path[index] == 47 {
                if directoryPaths.contains(path.prefix(index)) { return true }
            }
            return false
        }
        guard !roots.contains(where: { $0.identity == destination.identity }) else {
            throw ArchiveError.invalid("The output directory cannot also be an archive source")
        }

        let partial = ".NFD2NFC-\(UUID().uuidString).partial"
        let output = Darwin.openat(destination.fd, partial, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard output >= 0 else { throw ArchiveError.posix("Create temporary archive", errno) }
        var outputIsOpen = true
        var published = false
        defer {
            if outputIsOpen { Darwin.close(output) }
            if !published { Darwin.unlinkat(destination.fd, partial, 0) }
        }
        let writer = Writer(fd: output, excludedDirectory: destination.identity)
        var used = Set<Data>()
        for root in roots {
            try checkCancellation()
            let original = (root.canonicalPath as NSString).lastPathComponent
            let component = try uniqueComponent(original, used: &used)
            let opened = try openPath(root.url, directoryOnly: root.isDirectory)
            defer { Darwin.close(opened.fd) }
            guard opened.identity == root.identity else { throw ArchiveError.invalid("Source changed: \(root.url.path)") }
            try writer.append(fd: opened.fd, path: component, originalName: original, progress: progress)
        }
        try writer.finish()
        guard Darwin.fsync(output) == 0 else { throw ArchiveError.posix("Flush archive", errno) }
        let closeResult = Darwin.close(output)
        outputIsOpen = false
        guard closeResult == 0 else { throw ArchiveError.posix("Close archive", errno) }
        var suffix = 1
        while true {
            try checkCancellation()
            let filename = suffix == 1 ? "NFD2NFC.zip" : "NFD2NFC (\(suffix)).zip"
            if Darwin.renameatx_np(destination.fd, partial, destination.fd, filename, UInt32(RENAME_EXCL)) == 0 {
                published = true
                return ArchiveResult(url: directory.appendingPathComponent(filename), entryCount: writer.entries.count,
                                     convertedNameCount: writer.convertedNames, bytesRead: writer.bytesRead)
            }
            let code = errno
            guard code == EEXIST else { throw ArchiveError.posix("Publish archive", code) }
            suffix += 1
        }
    }

    private struct Identity: Hashable {
        let device: dev_t
        let inode: ino_t
        init(_ value: stat) { device = value.st_dev; inode = value.st_ino }
    }

    private struct Source {
        let url: URL
        let identity: Identity
        let ancestors: [Identity]
        let canonicalPath: String
        let isDirectory: Bool
    }

    private struct OpenedPath {
        let fd: Int32
        let identity: Identity
        let ancestors: [Identity]
        let canonicalPath: String
        let isDirectory: Bool
    }

    /// Open only the granted URL, not every ancestor (which sandbox grants need
    /// not allow opening). Ancestor aliases such as /var -> /private/var are valid;
    /// the selected entry itself and all traversal below it remain no-follow.
    private static func openPath(_ url: URL, directoryOnly: Bool) throws -> OpenedPath {
        guard url.isFileURL, url.path.hasPrefix("/"), !url.path.utf8.contains(0) else {
            throw ArchiveError.invalid("Only absolute local file URLs are supported")
        }
        let components = url.path.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard !components.isEmpty else { throw ArchiveError.invalid("The filesystem root cannot be archived") }
        for component in components { try validateComponent(component) }
        let flags = O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK | (directoryOnly ? O_DIRECTORY : 0)
        let fd = Darwin.open(url.path, flags)
        guard fd >= 0 else { throw ArchiveError.posix("Open selected entry without following symlinks: \(url.path)", errno) }
        do {
            let metadata = try checkedMetadata(fd, name: url.path)
            var pathBuffer = [CChar](repeating: 0, count: Int(MAXPATHLEN))
            let result = pathBuffer.withUnsafeMutableBufferPointer { Darwin.fcntl(fd, F_GETPATH, $0.baseAddress!) }
            guard result == 0 else { throw ArchiveError.posix("Resolve selected entry", errno) }
            guard let canonical = pathBuffer.withUnsafeBufferPointer({ String(validatingUTF8: $0.baseAddress!) }) else {
                throw ArchiveError.invalid("Non-UTF-8 source path")
            }
            var ancestors: [Identity] = []
            var parent = (canonical as NSString).deletingLastPathComponent
            while !parent.isEmpty {
                var value = stat()
                // Metadata may be denied outside the grant; canonical paths also
                // deduplicate nested selections without requiring ancestor opens.
                if Darwin.lstat(parent, &value) == 0 { ancestors.append(Identity(value)) }
                if parent == "/" { break }
                parent = (parent as NSString).deletingLastPathComponent
            }
            return OpenedPath(fd: fd, identity: Identity(metadata), ancestors: ancestors,
                              canonicalPath: canonical, isDirectory: metadata.st_mode & S_IFMT == S_IFDIR)
        } catch {
            Darwin.close(fd)
            throw error
        }
    }

    private static func checkCancellation() throws {
        if Task<Never, Never>.isCancelled { throw CancellationError() }
    }

    private static func checkedMetadata(_ fd: Int32, name: String) throws -> stat {
        var metadata = stat()
        guard Darwin.fstat(fd, &metadata) == 0 else { throw ArchiveError.posix("Read metadata: \(name)", errno) }
        let type = metadata.st_mode & S_IFMT
        guard type == S_IFREG || type == S_IFDIR else {
            throw ArchiveError.invalid("Symlinks and non-regular entries are not supported: \(name)")
        }
        return metadata
    }

    private static func validateComponent(_ component: String) throws {
        guard !component.isEmpty, component != ".", component != "..",
              !component.contains("/"), !component.contains("\\"), !component.utf8.contains(0) else {
            throw ArchiveError.invalid("Unsafe ZIP path component: \(component)")
        }
    }

    /// Reserve siblings by UTF-8 bytes, not Swift's canonically-equivalent String equality.
    private static func uniqueComponent(_ original: String, used: inout Set<Data>) throws -> String {
        try validateComponent(original)
        let normalized = NativeNormalizer.normalizedName(original)
        try validateComponent(normalized)
        var candidate = normalized
        var suffix = 2
        while !used.insert(Data(candidate.utf8)).inserted {
            candidate = "\(normalized) (\(suffix))"
            suffix += 1
        }
        return candidate
    }

    private static func dosTimestamp(_ seconds: time_t) -> (time: UInt16, date: UInt16) {
        var seconds = seconds
        var value = tm()
        localtime_r(&seconds, &value)
        let year = value.tm_year + 1900
        if year < 1980 { return (0, 0x0021) }
        if year > 2107 { return (0xbf7d, 0xff9f) }
        let time = UInt16(value.tm_hour << 11 | value.tm_min << 5 | min(value.tm_sec, 59) / 2)
        let date = UInt16((year - 1980) << 9 | (value.tm_mon + 1) << 5 | value.tm_mday)
        return (time, date)
    }

    private enum ArchiveError: Error, LocalizedError {
        case invalid(String)
        case posix(String, Int32)
        case compression(Int32)

        var errorDescription: String? {
            switch self {
            case .invalid(let message): return message
            case .posix(let operation, let code): return "\(operation): \(String(cString: strerror(code)))"
            case .compression(let code): return "DEFLATE failed (zlib \(code))"
            }
        }
    }

    private struct Entry {
        let name: Data
        let crc: UInt32
        let compressedSize: UInt64
        let size: UInt64
        let offset: UInt64
        let mode: mode_t
        let isDirectory: Bool
        let time: UInt16
        let date: UInt16
    }

    private final class Writer {
        let fd: Int32
        let excludedDirectory: Identity
        var entries: [Entry] = []
        var offset: UInt64 = 0
        var bytesRead: UInt64 = 0
        var filesProcessed = 0
        var convertedNames = 0
        private var input = [UInt8](repeating: 0, count: 64 * 1024)
        private var output = [UInt8](repeating: 0, count: 64 * 1024)

        init(fd: Int32, excludedDirectory: Identity) {
            self.fd = fd
            self.excludedDirectory = excludedDirectory
        }

        func append(fd source: Int32, path: String, originalName: String, progress: (ArchiveProgress) -> Void) throws {
            try checkCancellation()
            let metadata = try checkedMetadata(source, name: path)
            let isDirectory = metadata.st_mode & S_IFMT == S_IFDIR
            if isDirectory && Identity(metadata) == excludedDirectory { return }
            let filename = isDirectory ? path + "/" : path
            let name = Data(filename.utf8)
            guard name.count <= Int(UInt16.max) else { throw ArchiveError.invalid("ZIP path exceeds 65535 UTF-8 bytes") }
            if !originalName.utf8.elementsEqual(NativeNormalizer.normalizedName(originalName).utf8) {
                convertedNames += 1
            }
            let start = offset
            let timestamp = dosTimestamp(metadata.st_mtimespec.tv_sec)
            // All local headers use ZIP64 because a streaming input may grow past ZIP32.
            var header = Data()
            header.le(UInt32(0x04034b50)); header.le(UInt16(45)); header.le(UInt16(0x0808))
            header.le(UInt16(isDirectory ? 0 : 8)); header.le(timestamp.time); header.le(timestamp.date)
            header.le(UInt32(0)); header.le(UInt32.max); header.le(UInt32.max)
            header.le(UInt16(name.count)); header.le(UInt16(20)); header.append(name)
            header.le(UInt16(1)); header.le(UInt16(16)); header.le(UInt64(0)); header.le(UInt64(0))
            try write(header)
            let dataStart = offset
            var checksum: UInt32 = 0
            var size: UInt64 = 0
            if !isDirectory { (checksum, size) = try deflate(source, name: filename, progress: progress) }
            let compressedSize = offset - dataStart
            var descriptor = Data()
            descriptor.le(UInt32(0x08074b50)); descriptor.le(checksum)
            descriptor.le(compressedSize); descriptor.le(size)
            try write(descriptor)
            entries.append(Entry(name: name, crc: checksum, compressedSize: compressedSize, size: size,
                                 offset: start, mode: metadata.st_mode, isDirectory: isDirectory, time: timestamp.time, date: timestamp.date))
            if !isDirectory {
                filesProcessed += 1
                report(filename, progress: progress)
                return
            }
            var used = Set<Data>()
            for child in try children(of: source) {
                try checkCancellation()
                var childMetadata = stat()
                guard Darwin.fstatat(source, child, &childMetadata, AT_SYMLINK_NOFOLLOW) == 0 else {
                    throw ArchiveError.posix("Read child metadata: \(child)", errno)
                }
                let type = childMetadata.st_mode & S_IFMT
                guard type == S_IFREG || type == S_IFDIR else {
                    throw ArchiveError.invalid("Symlinks and non-regular entries are not supported: \(path)/\(child)")
                }
                if type == S_IFDIR && Identity(childMetadata) == excludedDirectory { continue }
                let component = try uniqueComponent(child, used: &used)
                let flags = O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | (type == S_IFDIR ? O_DIRECTORY : 0)
                let childFD = Darwin.openat(source, child, flags)
                guard childFD >= 0 else { throw ArchiveError.posix("Open child without following symlinks: \(child)", errno) }
                defer { Darwin.close(childFD) }
                let actual = try checkedMetadata(childFD, name: child)
                guard Identity(actual) == Identity(childMetadata), actual.st_mode & S_IFMT == type else {
                    throw ArchiveError.invalid("Source changed: \(path)/\(child)")
                }
                try append(fd: childFD, path: path + "/" + component, originalName: child, progress: progress)
            }
        }

        private func children(of fd: Int32) throws -> [String] {
            let duplicate = Darwin.dup(fd)
            guard duplicate >= 0 else { throw ArchiveError.posix("Duplicate directory descriptor", errno) }
            guard let directory = Darwin.fdopendir(duplicate) else {
                let code = errno
                Darwin.close(duplicate)
                throw ArchiveError.posix("Enumerate directory", code)
            }
            defer { Darwin.closedir(directory) }
            var names: [String] = []
            while true {
                try checkCancellation()
                errno = 0
                guard let entry = Darwin.readdir(directory) else {
                    guard errno == 0 else { throw ArchiveError.posix("Read directory", errno) }
                    break
                }
                let length = Int(entry.pointee.d_namlen)
                let bytes = withUnsafePointer(to: &entry.pointee.d_name) {
                    $0.withMemoryRebound(to: UInt8.self, capacity: length) { Data(bytes: $0, count: length) }
                }
                guard let name = String(data: bytes, encoding: .utf8) else { throw ArchiveError.invalid("Non-UTF-8 source filename") }
                if name == "." || name == ".." { continue }
                try validateComponent(name)
                names.append(name)
            }
            return names.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) }
        }

        private func deflate(_ source: Int32, name: String, progress: (ArchiveProgress) -> Void) throws -> (UInt32, UInt64) {
            var stream = z_stream()
            let initialized = deflateInit2_(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, -MAX_WBITS,
                                           8, Z_DEFAULT_STRATEGY, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
            guard initialized == Z_OK else { throw ArchiveError.compression(initialized) }
            defer { deflateEnd(&stream) }
            var checksum = uLong(0)
            var size: UInt64 = 0
            while true {
                try checkCancellation()
                let count = input.withUnsafeMutableBytes { Darwin.read(source, $0.baseAddress!, $0.count) }
                if count < 0 {
                    if errno == EINTR { continue }
                    throw ArchiveError.posix("Read source: \(name)", errno)
                }
                if count == 0 { break }
                try input.withUnsafeMutableBufferPointer { buffer in
                    checksum = crc32(checksum, buffer.baseAddress!, uInt(count))
                    stream.next_in = buffer.baseAddress!
                    stream.avail_in = uInt(count)
                    repeat { _ = try pump(&stream, flush: Z_NO_FLUSH) } while stream.avail_in > 0
                }
                size += UInt64(count)
                bytesRead += UInt64(count)
                report(name, progress: progress)
            }
            stream.next_in = nil
            stream.avail_in = 0
            while try pump(&stream, flush: Z_FINISH) != Z_STREAM_END {}
            return (UInt32(truncatingIfNeeded: checksum), size)
        }

        private func pump(_ stream: inout z_stream, flush: Int32) throws -> Int32 {
            try checkCancellation()
            return try output.withUnsafeMutableBufferPointer { buffer in
                stream.next_out = buffer.baseAddress!
                stream.avail_out = uInt(buffer.count)
                let result = zlib.deflate(&stream, flush)
                guard result == Z_OK || result == Z_STREAM_END else { throw ArchiveError.compression(result) }
                try write(buffer.baseAddress!, count: buffer.count - Int(stream.avail_out))
                return result
            }
        }

        private func report(_ name: String, progress: (ArchiveProgress) -> Void) {
            progress(ArchiveProgress(filesProcessed: filesProcessed, bytesProcessed: bytesRead, currentName: name))
        }

        func finish() throws {
            let centralStart = offset
            for entry in entries {
                try checkCancellation()
                var header = Data()
                header.le(UInt32(0x02014b50)); header.le(UInt16(0x032d)); header.le(UInt16(45))
                header.le(UInt16(0x0808)); header.le(UInt16(entry.isDirectory ? 0 : 8))
                header.le(entry.time); header.le(entry.date); header.le(entry.crc)
                header.le(UInt32.max); header.le(UInt32.max); header.le(UInt16(entry.name.count))
                header.le(UInt16(28)); header.le(UInt16(0)); header.le(UInt16(0)); header.le(UInt16(0))
                header.le((UInt32(entry.mode) << 16) | (entry.isDirectory ? UInt32(0x10) : 0))
                header.le(UInt32.max); header.append(entry.name)
                header.le(UInt16(1)); header.le(UInt16(24)); header.le(entry.size)
                header.le(entry.compressedSize); header.le(entry.offset)
                try write(header)
            }
            let centralSize = offset - centralStart
            let zip64Offset = offset
            var trailer = Data()
            trailer.le(UInt32(0x06064b50)); trailer.le(UInt64(44)); trailer.le(UInt16(45)); trailer.le(UInt16(45))
            trailer.le(UInt32(0)); trailer.le(UInt32(0)); trailer.le(UInt64(entries.count)); trailer.le(UInt64(entries.count))
            trailer.le(centralSize); trailer.le(centralStart)
            trailer.le(UInt32(0x07064b50)); trailer.le(UInt32(0)); trailer.le(zip64Offset); trailer.le(UInt32(1))
            trailer.le(UInt32(0x06054b50)); trailer.le(UInt16(0)); trailer.le(UInt16(0))
            trailer.le(UInt16(clamping: entries.count)); trailer.le(UInt16(clamping: entries.count))
            trailer.le(UInt32(clamping: centralSize)); trailer.le(UInt32(clamping: centralStart)); trailer.le(UInt16(0))
            try write(trailer)
        }

        private func write(_ data: Data) throws {
            try data.withUnsafeBytes { buffer in
                if let base = buffer.baseAddress { try write(base, count: buffer.count) }
            }
        }

        private func write(_ bytes: UnsafeRawPointer, count: Int) throws {
            var written = 0
            while written < count {
                let amount = Darwin.write(fd, bytes.advanced(by: written), count - written)
                if amount < 0 {
                    if errno == EINTR { continue }
                    throw ArchiveError.posix("Write archive", errno)
                }
                guard amount > 0 else { throw ArchiveError.invalid("Archive write made no progress") }
                written += amount
                offset += UInt64(amount)
            }
        }
    }
}

private extension Data {
    mutating func le<T: FixedWidthInteger>(_ value: T) {
        var little = value.littleEndian
        Swift.withUnsafeBytes(of: &little) { append(contentsOf: $0) }
    }
}
