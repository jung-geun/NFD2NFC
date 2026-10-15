import Foundation
import CoreServices
import Dispatch

/// One event stream and one serial executor. Only startup, added roots, and lost
/// event/root recovery traverse complete roots. Ordinary file events list only
/// their parent to obtain the entry's actual UTF-8 spelling, then visit that entry.
public final class DirectoryMonitor: @unchecked Sendable {
    private static let entryFlags = FSEventStreamEventFlags(kFSEventStreamEventFlagItemCreated | kFSEventStreamEventFlagItemRenamed)
    private static let recoveryFlags = FSEventStreamEventFlags(kFSEventStreamEventFlagMustScanSubDirs | kFSEventStreamEventFlagUserDropped | kFSEventStreamEventFlagKernelDropped | kFSEventStreamEventFlagEventIdsWrapped | kFSEventStreamEventFlagRootChanged | kFSEventStreamEventFlagMount | kFSEventStreamEventFlagUnmount)
    private let queue = DispatchQueue(label: "NormalizationCore.DirectoryMonitor", qos: .utility)
    private let queueKey = DispatchSpecificKey<UInt8>()
    private let onBatch: @Sendable (ConversionBatch) -> Void
    private var roots: [WatchRoot] = []
    private var rootHandles: [UUID: AuthorizedDirectory] = [:]
    private var rootErrors: [UUID: String] = [:]
    private var exclusions: [RevertedName] = []
    private var localUndoNames: [RevertedName] = []
    private var stream: FSEventStreamRef?
    private var generation: UInt64 = 0
    private var lastEventID: FSEventStreamEventId?
    private var pending: [String: FSEventStreamEventFlags] = [:]
    private var scheduled: DispatchWorkItem?

    public init(onBatch: @escaping @Sendable (ConversionBatch) -> Void) {
        self.onBatch = onBatch
        queue.setSpecific(key: queueKey, value: 1)
    }

    public func setRoots(_ roots: [WatchRoot], exclusions: [RevertedName],
                         completion: @escaping @Sendable () -> Void = {}) {
        queue.async { [self] in
            let incoming = roots.map { root in
                let path = root.url.standardizedFileURL.path
                let canonical = (try? NativeNormalizer.canonicalPath(path, allowMissing: true)) ?? path
                return WatchRoot(id: root.id, url: NativeNormalizer.fileURL(canonical))
            }.sorted { $0.id.uuidString < $1.id.uuidString }
            if self.roots == incoming, stream != nil || incoming.isEmpty {
                self.exclusions = exclusions
                mergeLocalExclusions()
                completion()
                return
            }
            // Old scopes remain authorized until this completion. Drain old work
            // before changing the protection set or starting scans on new roots.
            destroyStream()
            let drainGeneration = generation
            drain()
            guard generation == drainGeneration else { completion(); return }
            let oldRoots = self.roots
            let previouslyAvailable = Set(rootHandles.keys)
            self.roots = incoming
            prepareRootHandles()
            self.exclusions = exclusions
            localUndoNames.removeAll { item in
                guard let id = item.rootID else { return false }
                return !incoming.contains(where: { $0.id == id })
            }
            mergeLocalExclusions()
            createStream()
            guard self.roots == incoming else { completion(); return }
            let added = incoming.filter { root in
                !previouslyAvailable.contains(root.id) || !oldRoots.contains(where: { $0.id == root.id && $0.url == root.url })
            }
            scan(added)
            completion()
        }
    }

    public func revert(_ record: ConversionRecord,
                       completion: @escaping @Sendable (Result<ConversionRecord, Error>) -> Void) {
        queue.async { [self] in
            do {
                guard let identity = record.identity else { throw NativeFileError("되돌리기에 필요한 원래 항목 정보가 없습니다.") }
                guard let owner = owningRoot(record.currentPath),
                      record.rootID == nil || owner.id == record.rootID else {
                    throw NativeFileError("이 항목의 감시 폴더가 더 이상 선택되어 있지 않습니다.")
                }
                guard !roots.contains(where: {
                    NativeNormalizer.contains(record.currentPath, $0.url.path)
                }) else { throw NativeFileError("선택한 감시 폴더의 이름은 변경할 수 없습니다.") }
                // Pending conversion notifications must be delivered before undo,
                // so callbacks cannot report an undo followed by an older rename.
                let undoGeneration = generation
                drain()
                guard generation == undoGeneration, owningRoot(record.currentPath)?.id == owner.id else {
                    throw NativeFileError("감시가 종료되어 되돌리지 않았습니다. 항목은 변경되지 않았습니다.")
                }
                guard let handle = rootHandles[owner.id] else {
                    throw NativeFileError(rootErrors[owner.id] ?? "선택한 폴더에 접근할 수 없습니다. 폴더를 다시 추가해 주세요.")
                }
                let reverted = try NativeNormalizer.revert(record, root: handle)
                let exclusion = RevertedName(identity: identity,
                                             name: NativeNormalizer.basename(reverted.currentPath),
                                             rootID: owner.id)
                if !localUndoNames.contains(where: { sameExclusion($0, exclusion) }) {
                    localUndoNames.append(exclusion)
                }
                mergeLocalExclusions()
                // The exclusion is installed on this queue before FSEvents can
                // process the reverse rename. The app persists the returned name.
                completion(.success(reverted))
            } catch { completion(.failure(error)) }
        }
    }

    /// Synchronous and reentrant from callbacks. Invalidate first, process queued
    /// paths while scopes are live, then return with no future filesystem work.
    public func stop() {
        sync {
            destroyStream()
            drain()
            roots.removeAll()
            rootHandles.removeAll()
            rootErrors.removeAll()
        }
    }

    deinit {
        // stop() is normally called explicitly before releasing security scopes.
        if DispatchQueue.getSpecific(key: queueKey) != nil { destroyStream() }
        else { queue.sync { destroyStream() } }
    }

    private func sync(_ work: () -> Void) {
        if DispatchQueue.getSpecific(key: queueKey) != nil { work() }
        else { queue.sync(execute: work) }
    }

    private func prepareRootHandles() {
        rootHandles = rootHandles.filter { id, handle in
            roots.contains { $0.id == id && $0.url.path == handle.path }
        }
        rootErrors = rootErrors.filter { id, _ in roots.contains { $0.id == id } }
        for root in roots {
            if let existing = rootHandles[root.id], (try? existing.validate()) != nil { continue }
            do {
                // Recovery may reopen the selected path, but must never resolve
                // a replacement symlink into a newly unauthorized destination.
                guard try NativeNormalizer.canonicalPath(root.url.path) == root.url.path else {
                    throw NativeFileError("선택한 폴더 경로가 달라졌습니다. 폴더를 다시 추가해 주세요.")
                }
                rootHandles[root.id] = try AuthorizedDirectory(path: root.url.path)
                rootErrors.removeValue(forKey: root.id)
            } catch {
                rootHandles.removeValue(forKey: root.id)
                rootErrors[root.id] = error.localizedDescription
            }
        }
    }

    private func mergeLocalExclusions() {
        for item in localUndoNames where !exclusions.contains(where: { sameExclusion($0, item) }) {
            exclusions.append(item)
        }
    }

    private func sameExclusion(_ a: RevertedName, _ b: RevertedName) -> Bool {
        a.identity == b.identity && a.rootID == b.rootID && NativeNormalizer.rawEqual(a.name, b.name)
    }

    private final class Context {
        weak var owner: DirectoryMonitor?
        let generation: UInt64
        init(owner: DirectoryMonitor, generation: UInt64) { self.owner = owner; self.generation = generation }
    }

    private func createStream() {
        let activeRoots = collapse(roots.filter { rootHandles[$0.id] != nil })
        guard !activeRoots.isEmpty else { return }
        let since = lastEventID ?? FSEventsGetCurrentEventId()
        lastEventID = since
        let token = Context(owner: self, generation: generation)
        var context = FSEventStreamContext(
            version: 0, info: Unmanaged.passUnretained(token).toOpaque(),
            retain: { pointer in
                guard let pointer else { return nil }
                _ = Unmanaged<Context>.fromOpaque(pointer).retain()
                return pointer
            },
            release: { pointer in
                if let pointer { Unmanaged<Context>.fromOpaque(pointer).release() }
            }, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagWatchRoot | kFSEventStreamCreateFlagNoDefer)
        let created = withExtendedLifetime(token) { FSEventStreamCreate(kCFAllocatorDefault, { _, info, count, paths, flags, ids in
            guard let info else { return }
            let token = Unmanaged<Context>.fromOpaque(info).takeUnretainedValue()
            guard let owner = token.owner, token.generation == owner.generation else { return }
            // Without UseCFTypes, the callback contains count NUL-terminated paths.
            let names = paths.assumingMemoryBound(to: UnsafePointer<CChar>.self)
            for index in 0..<count {
                if flags[index] & FSEventStreamEventFlags(kFSEventStreamEventFlagEventIdsWrapped) != 0 {
                    owner.lastEventID = ids[index]
                } else {
                    owner.lastEventID = max(owner.lastEventID ?? 0, ids[index])
                }
                owner.receive(String(cString: names[index]), flags: flags[index])
            }
        }, &context, activeRoots.map { $0.url.path } as CFArray,
        since, 0.15, flags) }
        guard let created else {
            emitStreamFailure("파일 시스템 감시를 만들 수 없습니다. 폴더를 다시 추가해 주세요.")
            return
        }
        stream = created
        FSEventStreamSetDispatchQueue(created, queue)
        guard FSEventStreamStart(created) else {
            destroyStream()
            emitStreamFailure("파일 시스템 감시를 시작할 수 없습니다. 폴더를 다시 추가해 접근 권한을 갱신해 주세요.")
            return
        }
    }

    private func destroyStream() {
        generation &+= 1
        if let stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
        }
        // Already submitted callbacks carry an obsolete generation and cannot
        // touch released scopes. Pending paths are explicitly drained by caller.
    }

    private func emitStreamFailure(_ message: String) {
        let failureGeneration = generation
        var batch = ConversionBatch()
        for root in roots {
            batch.issues.append(MonitorIssue(rootID: root.id, path: root.url.path, message: message))
            NativeNormalizer.flushIfNeeded(&batch, onBatch: publish)
            guard generation == failureGeneration else { return }
        }
        publish(batch)
    }

    private func receive(_ path: String, flags: FSEventStreamEventFlags) {
        // Like the old add/addDir watcher, content and metadata writes alone do
        // not rename entries or enumerate their (possibly enormous) parent.
        guard flags & (Self.entryFlags | Self.recoveryFlags) != 0 else { return }
        pending[path, default: 0] |= flags
        guard scheduled == nil else { return }
        let work = DispatchWorkItem { [weak self] in self?.drain() }
        scheduled = work
        // Fixed latency from first event, not an endlessly extended debounce.
        queue.asyncAfter(deadline: .now() + .milliseconds(120), execute: work)
    }

    private func drain() {
        scheduled?.cancel()
        scheduled = nil
        guard !pending.isEmpty else { return }
        let events = pending
        pending.removeAll(keepingCapacity: true)
        let workGeneration = generation
        let recovery = Self.recoveryFlags
        if events.values.contains(where: { $0 & recovery != 0 }) {
            var batch = ConversionBatch()
            let unavailable = FSEventStreamEventFlags(kFSEventStreamEventFlagRootChanged | kFSEventStreamEventFlagUnmount)
            for (path, flags) in events where flags & unavailable != 0 {
                let affected = roots.filter { NativeNormalizer.contains($0.url.path, path) || NativeNormalizer.contains(path, $0.url.path) }
                for root in affected.isEmpty ? roots : affected {
                    batch.issues.append(MonitorIssue(rootID: root.id, path: root.url.path,
                                                     message: "감시 폴더가 이동되었거나 사용할 수 없습니다. 접근 권한이 달라졌다면 폴더를 다시 추가해 주세요."))
                    NativeNormalizer.flushIfNeeded(&batch, onBatch: publish)
                    guard generation == workGeneration else { return }
                }
            }
            let rootChanges = FSEventStreamEventFlags(kFSEventStreamEventFlagRootChanged | kFSEventStreamEventFlagMount | kFSEventStreamEventFlagUnmount)
            if stream != nil && events.values.contains(where: { $0 & rootChanges != 0 }) {
                // A stream can follow the old inode after a root moves. Retarget
                // the still-authorized selected paths, never its new location.
                destroyStream()
                prepareRootHandles()
                createStream()
            }
            scan(roots, into: &batch)
            publish(batch)
            return
        }
        var batch = ConversionBatch()
        var coveredSubtrees: [String] = []
        let protectedPaths = roots.map { $0.url.path }
        let activeExclusions = engineExclusions
        let ordered = events.keys.sorted {
            let a = $0.split(separator: "/").count, b = $1.split(separator: "/").count
            return a == b ? $0.utf8.lexicographicallyPrecedes($1.utf8) : a < b
        }
        for path in ordered {
            guard generation == workGeneration else { return }
            guard let owner = owningRoot(path), let handle = rootHandles[owner.id],
                  !ignoredAncestor(of: path, root: owner.url.path),
                  !coveredSubtrees.contains(where: { NativeNormalizer.contains($0, path) }) else { continue }
            let flags = events[path] ?? 0
            let recursive = flags & FSEventStreamEventFlags(kFSEventStreamEventFlagItemIsDir) != 0 &&
                flags & Self.entryFlags != 0
            if recursive { coveredSubtrees.append(path) }
            NativeNormalizer.normalizePath(path, root: handle, rootID: owner.id, recursive: recursive,
                                           protectedPaths: protectedPaths, exclusions: activeExclusions, batch: &batch,
                                           onBatch: publish,
                                           isActive: { generation == workGeneration && rootHandles[owner.id] === handle })
        }
        publish(batch)
    }

    private var engineExclusions: [RevertedName] {
        // The scan set collapses nested roots. Identity+raw name is the durable
        // exclusion key; records are assigned to their most-specific root below.
        exclusions.filter { item in item.rootID == nil || roots.contains { $0.id == item.rootID } }
            .map { RevertedName(identity: $0.identity, name: $0.name, rootID: nil) }
    }

    private func scan(_ selected: [WatchRoot]) {
        var batch = ConversionBatch()
        scan(selected, into: &batch)
        publish(batch)
    }

    private func scan(_ selected: [WatchRoot], into batch: inout ConversionBatch) {
        let scanGeneration = generation
        let protectedPaths = roots.map { $0.url.path }
        let activeExclusions = engineExclusions
        for root in selected where rootHandles[root.id] == nil {
            guard generation == scanGeneration else { return }
            batch.issues.append(MonitorIssue(rootID: root.id, path: root.url.path,
                                             message: rootErrors[root.id] ?? "선택한 폴더에 접근할 수 없습니다. 폴더를 다시 추가해 주세요."))
            NativeNormalizer.flushIfNeeded(&batch, onBatch: publish)
        }
        for root in collapse(selected.filter({ rootHandles[$0.id] != nil })) {
            guard generation == scanGeneration else { return }
            guard let handle = rootHandles[root.id] else { continue }
            NativeNormalizer.normalizeRoot(handle, rootID: root.id, protectedPaths: protectedPaths,
                                           exclusions: activeExclusions, batch: &batch, onBatch: publish,
                                           isActive: { generation == scanGeneration && rootHandles[root.id] === handle })
        }
    }


    private func publish(_ incoming: ConversionBatch) {
        guard !incoming.records.isEmpty || !incoming.issues.isEmpty else { return }
        var batch = incoming
        for index in batch.records.indices {
            batch.records[index].rootID = owningRoot(batch.records[index].currentPath)?.id
        }
        for index in batch.issues.indices {
            batch.issues[index].rootID = owningRoot(batch.issues[index].path)?.id ?? batch.issues[index].rootID
        }
        onBatch(batch)
    }

    private func owningRoot(_ path: String) -> WatchRoot? {
        roots.lazy.filter { NativeNormalizer.contains($0.url.path, path) }
            .max { $0.url.path.split(separator: "/").count < $1.url.path.split(separator: "/").count }
    }

    private func collapse(_ roots: [WatchRoot]) -> [WatchRoot] {
        var result: [WatchRoot] = []
        for root in roots.sorted(by: {
            let a = $0.url.path.split(separator: "/").count, b = $1.url.path.split(separator: "/").count
            return a == b ? $0.id.uuidString < $1.id.uuidString : a < b
        }) {
            if !result.contains(where: { NativeNormalizer.contains($0.url.path, root.url.path) }) { result.append(root) }
        }
        return result
    }

    private func ignoredAncestor(of path: String, root: String) -> Bool {
        var current = NativeNormalizer.parent(path)
        while NativeNormalizer.contains(root, current) {
            if NativeNormalizer.isIgnored(name: NativeNormalizer.basename(current)) { return true }
            if current == root { break }
            let next = NativeNormalizer.parent(current)
            if next == current { break }
            current = next
        }
        return false
    }
}
