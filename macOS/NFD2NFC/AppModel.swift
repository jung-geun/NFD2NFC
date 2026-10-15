import AppKit
import Combine
import Darwin
import NormalizationCore
import ServiceManagement
import UserNotifications

// Login item registration belongs to macOS, not to a persisted checkbox.
enum AppTab: Hashable {
    case watching, history, general
}

@MainActor
final class AppModel: ObservableObject {
    @Published var selectedTab: AppTab = .watching
    @Published private(set) var directories: [WatchedDirectory]
    @Published private(set) var history: [ConversionRecord]
    @Published private(set) var directoryErrors: [UUID: String] = [:]
    @Published var notificationsEnabled: Bool { didSet { preferencesChanged(); notificationSettingsChanged() } }
    @Published var notificationInterval: Int {
        didSet {
            if notificationInterval < 1 {
                notificationInterval = 1
                return
            }
            preferencesChanged()
            rescheduleNotification()
        }
    }
    @Published var hideDockIcon: Bool { didSet { preferencesChanged(); visibilityChanged?() } }
    @Published var hideMenuBarIcon: Bool { didSet { preferencesChanged(); visibilityChanged?() } }
    @Published private(set) var launchAtLogin = false
    @Published private(set) var loginRequiresApproval = false
    @Published private(set) var notificationsDenied = false
    @Published var errorMessage: String?
    @Published private(set) var archiveIsRunning = false
    @Published private(set) var archiveProgress: ArchiveProgress?
    @Published private(set) var lastArchiveURL: URL?
    @Published private(set) var archiveStatus = ""
    @Published private(set) var revertingIDs: Set<UUID> = []

    var visibilityChanged: (() -> Void)?
    var windowRequested: ((AppTab) -> Void)?
    var prepareForPanel: (() -> Void)?

    private var state: SavedState
    private let store: StateStore
    private var canPersist = true
    private var scopes: [UUID: URL] = [:]
    private var notificationCount = 0
    private var notificationTask: Task<Void, Never>?
    private var archiveTask: Task<Void, Never>?
    private var archiveWork: Task<ArchiveResult, Error>?
    private var shuttingDown = false
    private lazy var monitor = DirectoryMonitor { [weak self] batch in
        DispatchQueue.main.async { self?.receive(batch) }
    }

    init(store: StateStore = StateStore()) {
        self.store = store
        var loadError: Error?
        do { state = try store.load() }
        catch { state = SavedState(); loadError = error }
        directories = state.directories
        history = Array(state.history.prefix(1000))
        notificationsEnabled = state.preferences.notificationsEnabled
        notificationInterval = max(1, state.preferences.notificationInterval)
        hideDockIcon = state.preferences.hideDockIcon
        hideMenuBarIcon = state.preferences.hideMenuBarIcon
        if let loadError {
            canPersist = false
            errorMessage = "설정을 읽지 못했습니다. 기존 설정을 보호하기 위해 저장을 중단했습니다. \(loadError.localizedDescription)"
        }
        store.onError = { [weak self] error in
            DispatchQueue.main.async { self?.errorMessage = "설정을 저장하지 못했습니다. \(error.localizedDescription)" }
        }
        lastArchiveURL = history.first(where: { $0.kind == .archive }).map { URL(fileURLWithPath: $0.currentPath) }
    }

    func start() {
        refreshLoginStatus()
        refreshNotificationStatus()
        refreshMonitoring()
    }

    func becameActive() {
        refreshLoginStatus()
        refreshNotificationStatus()
        refreshMonitoring()
    }

    func chooseDirectories() {
        prepareForPanel?()
        let panel = NSOpenPanel()
        panel.title = "실시간 감시할 디렉토리 추가"
        panel.message = "선택한 디렉토리의 모든 하위 폴더를 감시하고 한글 파일명을 자동으로 변환합니다."
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "감시 시작"
        guard panel.runModal() == .OK else { return }
        for url in panel.urls {
            defer { url.stopAccessingSecurityScopedResource() }
            do {
                let bookmark = try url.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
                if let index = directories.firstIndex(where: { $0.path == url.path }) {
                    directories[index].bookmarkData = bookmark
                    if let previous = scopes.removeValue(forKey: directories[index].id) {
                        monitor.setRoots(scopes.map { WatchRoot(id: $0.key, url: $0.value) }, exclusions: state.exclusions) {
                            previous.stopAccessingSecurityScopedResource()
                        }
                    }
                } else {
                    directories.append(WatchedDirectory(path: url.path, bookmarkData: bookmark))
                }
            } catch { errorMessage = "폴더 접근 권한을 저장하지 못했습니다. \(error.localizedDescription)" }
        }
        refreshMonitoring()
        save()
        ensureNotificationAuthorization()
    }

    func openDirectory(_ directory: WatchedDirectory) {
        guard let url = scopes[directory.id] else {
            errorMessage = "폴더를 다시 추가해 접근 권한을 허용해주세요."
            return
        }
        if !NSWorkspace.shared.open(url) { errorMessage = "Finder에서 폴더를 열지 못했습니다." }
    }

    func removeDirectory(_ directory: WatchedDirectory) {
        directories.removeAll { $0.id == directory.id }
        directoryErrors.removeValue(forKey: directory.id)
        state.exclusions.removeAll { $0.rootID == directory.id }
        refreshMonitoring()
        save()
    }

    func reveal(_ record: ConversionRecord) {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: record.currentPath)])
    }

    func copyPath(_ record: ConversionRecord) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(record.currentPath, forType: .string)
    }

    func revert(_ record: ConversionRecord) {
        guard record.kind == .rename, !record.reverted, !revertingIDs.contains(record.id) else { return }
        revertingIDs.insert(record.id)
        monitor.revert(record) { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                self.revertingIDs.remove(record.id)
                switch result {
                case .success(let reverted):
                    if record.isDirectory { self.rebaseHistory(from: record.currentPath, to: reverted.currentPath) }
                    if let index = self.history.firstIndex(where: { $0.id == record.id }) { self.history[index] = reverted }
                    if let identity = record.identity {
                        self.state.exclusions.removeAll { $0.identity == identity }
                        self.state.exclusions.append(RevertedName(identity: identity,
                            name: (reverted.currentPath as NSString).lastPathComponent, rootID: record.rootID))
                    }
                    self.save()
                case .failure(let error): self.errorMessage = "되돌리지 못했습니다. \(error.localizedDescription)"
                }
            }
        }
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled { try SMAppService.mainApp.register() }
            else { try SMAppService.mainApp.unregister() }
        } catch { errorMessage = "로그인 시 자동 실행을 변경하지 못했습니다. \(error.localizedDescription)" }
        refreshLoginStatus()
    }

    func openLoginItemsSettings() { SMAppService.openSystemSettingsLoginItems() }

    func openNotificationSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") {
            NSWorkspace.shared.open(url)
        }
    }

    func chooseArchiveFiles() {
        guard !archiveIsRunning else { return }
        prepareForPanel?()
        let panel = NSOpenPanel()
        panel.title = "NFC 이름의 ZIP으로 저장할 파일·폴더 선택"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.prompt = "ZIP 만들기"
        guard panel.runModal() == .OK else { return }
        archiveFiles(panel.urls)
    }

    // Called synchronously from performDragOperation, before the pasteboard grant expires.
    func archiveFiles(_ urls: [URL]) {
        guard !archiveIsRunning, !shuttingDown else { return }
        guard !urls.isEmpty, urls.allSatisfy(\.isFileURL) else {
            errorMessage = "이 Mac에 있는 파일 또는 폴더를 선택해주세요."
            return
        }
        archiveIsRunning = true
        archiveProgress = nil
        archiveStatus = "저장 폴더 확인 중…"
        // Redeem each original scoped URL now; never reconstruct it from a path first.
        let started = urls.filter { $0.startAccessingSecurityScopedResource() }
        let destination: URL
        do { destination = try authorizedArchiveDirectory() }
        catch {
            started.forEach { $0.stopAccessingSecurityScopedResource() }
            urls.forEach { $0.stopAccessingSecurityScopedResource() }
            archiveIsRunning = false
            archiveStatus = ""
            if (error as NSError).code != NSUserCancelledError { errorMessage = error.localizedDescription }
            return
        }
        archiveStatus = "NFC 이름의 ZIP 생성 중…"
        ensureNotificationAuthorization()
        let work = Task.detached(priority: .userInitiated) { [weak self] in
            var lastUpdate = Date.distantPast
            return try ZIPArchiver.createArchive(from: urls, in: destination) { progress in
                let now = Date()
                guard now.timeIntervalSince(lastUpdate) >= 0.1 else { return }
                lastUpdate = now
                DispatchQueue.main.async { self?.archiveProgress = progress }
            }
        }
        archiveWork = work
        archiveTask = Task { [weak self] in
            defer {
                started.forEach { $0.stopAccessingSecurityScopedResource() }
                urls.forEach { $0.stopAccessingSecurityScopedResource() }
                destination.stopAccessingSecurityScopedResource()
            }
            guard let self else { work.cancel(); return }
            do {
                let result = try await work.value
                self.lastArchiveURL = result.url
                self.archiveProgress = ArchiveProgress(filesProcessed: result.entryCount, bytesProcessed: result.bytesRead,
                    currentName: result.url.lastPathComponent)
                self.archiveStatus = "\(result.entryCount)개 항목을 ZIP으로 저장했습니다. 원본은 변경하지 않았습니다."
                self.history.insert(ConversionRecord(rootID: nil, originalPath: urls[0].path,
                    currentPath: result.url.path, isDirectory: false, identity: nil, kind: .archive), at: 0)
                self.trimHistory()
                self.save()
                self.queueNotification(count: 1)
            } catch is CancellationError {
                self.archiveStatus = "ZIP 생성을 취소했습니다."
            } catch {
                self.archiveStatus = "ZIP을 만들지 못했습니다."
                self.errorMessage = error.localizedDescription
            }
            self.archiveIsRunning = false
            self.archiveWork = nil
            self.archiveTask = nil
        }
    }

    func openArchiveFolder() {
        do {
            let url = try authorizedArchiveDirectory()
            defer { url.stopAccessingSecurityScopedResource() }
            if !NSWorkspace.shared.open(url) { errorMessage = "저장 폴더를 열지 못했습니다." }
        } catch {
            if (error as NSError).code != NSUserCancelledError { errorMessage = error.localizedDescription }
        }
    }

    func revealLastArchive() {
        guard let lastArchiveURL else { return }
        NSWorkspace.shared.activateFileViewerSelecting([lastArchiveURL])
    }

    func showMainWindow(tab: AppTab = .watching) { selectedTab = tab; windowRequested?(tab) }
    func quit() { NSApp.terminate(nil) }

    func shutdown() async {
        shuttingDown = true
        archiveWork?.cancel()
        await archiveTask?.value
        notificationTask?.cancel()
        let monitor = self.monitor
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .utility).async {
                monitor.stop()
                // All earlier monitor batches have already been enqueued on this queue.
                DispatchQueue.main.async { continuation.resume() }
            }
        }
        save()
        store.flush()
        scopes.values.forEach { $0.stopAccessingSecurityScopedResource() }
        scopes.removeAll()
    }

    static func abbreviatedParentPath(_ path: String) -> String {
        let parent = URL(fileURLWithPath: path).deletingLastPathComponent()
        let components = parent.pathComponents.filter { $0 != "/" }
        return components.count > 2 ? "…/" + components.suffix(2).joined(separator: "/") : parent.path
    }

    private func refreshMonitoring() {
        guard !shuttingDown else { return }
        var next: [UUID: URL] = [:]
        var retained = Set<UUID>()
        for index in directories.indices {
            let directory = directories[index]
            if let current = scopes[directory.id], FileManager.default.fileExists(atPath: current.path) {
                next[directory.id] = current
                retained.insert(directory.id)
                continue
            }
            do {
                var stale = false
                let url = try URL(resolvingBookmarkData: directory.bookmarkData,
                    options: [.withSecurityScope, .withoutUI], relativeTo: nil, bookmarkDataIsStale: &stale)
                guard url.startAccessingSecurityScopedResource() else {
                    throw Self.failure("폴더 접근 권한이 만료되었습니다. 폴더를 다시 추가해주세요.")
                }
                var isDirectory: ObjCBool = false
                guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                    url.stopAccessingSecurityScopedResource()
                    throw Self.failure("폴더를 찾을 수 없습니다. 디스크 연결 또는 폴더 위치를 확인해주세요.")
                }
                next[directory.id] = url
                if !directory.path.utf8.elementsEqual(url.path.utf8) {
                    rebaseHistory(from: directory.path, to: url.path)
                    directories[index].path = url.path
                }
                if stale {
                    directories[index].bookmarkData = try url.bookmarkData(options: .withSecurityScope,
                        includingResourceValuesForKeys: nil, relativeTo: nil)
                }
                if next[directory.id] != nil { directoryErrors.removeValue(forKey: directory.id) }
            } catch { directoryErrors[directory.id] = error.localizedDescription }
        }
        // A moved folder resolves a new scope under the same ID; the replaced scope must be released too.
        let released = scopes.filter { !retained.contains($0.key) }.map(\.value)
        scopes = next
        monitor.setRoots(next.map { WatchRoot(id: $0.key, url: $0.value) }, exclusions: state.exclusions) {
            released.forEach { $0.stopAccessingSecurityScopedResource() }
        }
        save()
    }

    private func receive(_ batch: ConversionBatch) {
        for record in batch.records {
            if record.isDirectory { rebaseHistory(from: record.originalPath, to: record.currentPath) }
            if let root = record.rootID { directoryErrors.removeValue(forKey: root) }
        }
        history.insert(contentsOf: batch.records.reversed(), at: 0)
        for issue in batch.issues {
            let message = "\(issue.message)\n\(issue.path)"
            if let root = issue.rootID { directoryErrors[root] = message }
            else { for directory in directories { directoryErrors[directory.id] = message } }
        }
        trimHistory()
        if !batch.records.isEmpty { save(); queueNotification(count: batch.records.count) }
    }

    private func rebaseHistory(from old: String, to new: String) {
        for index in history.indices {
            history[index].currentPath = Self.rebased(history[index].currentPath, from: old, to: new, includeExact: true)
            history[index].originalPath = Self.rebased(history[index].originalPath, from: old, to: new, includeExact: false)
        }
    }

    private static func rebased(_ path: String, from old: String, to new: String, includeExact: Bool) -> String {
        if includeExact && path.utf8.elementsEqual(old.utf8) { return new }
        let prefix = old.hasSuffix("/") ? old : old + "/"
        guard path.utf8.starts(with: prefix.utf8) else { return path }
        return new + "/" + String(decoding: path.utf8.dropFirst(prefix.utf8.count), as: UTF8.self)
    }


    private func trimHistory() { if history.count > 1000 { history.removeLast(history.count - 1000) } }

    private func preferencesChanged() {
        state.preferences = AppPreferences(notificationsEnabled: notificationsEnabled,
            notificationInterval: notificationInterval, hideDockIcon: hideDockIcon, hideMenuBarIcon: hideMenuBarIcon)
        save()
    }

    private func save() {
        guard canPersist else { return }
        state.directories = directories
        state.history = history
        store.scheduleSave(state)
    }

    private func refreshLoginStatus() {
        let status = SMAppService.mainApp.status
        launchAtLogin = status == .enabled || status == .requiresApproval
        loginRequiresApproval = status == .requiresApproval
    }

    private func refreshNotificationStatus() {
        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            DispatchQueue.main.async { self?.notificationsDenied = settings.authorizationStatus == .denied }
        }
    }

    private func ensureNotificationAuthorization() {
        guard notificationsEnabled, !shuttingDown else { return }
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { [weak self] _, error in
            DispatchQueue.main.async {
                self?.refreshNotificationStatus()
                if let error { self?.errorMessage = "알림 권한을 확인하지 못했습니다. \(error.localizedDescription)" }
            }
        }
    }

    private func notificationSettingsChanged() {
        notificationTask?.cancel()
        notificationTask = nil
        if notificationsEnabled { ensureNotificationAuthorization(); rescheduleNotification() }
        else { notificationCount = 0 }
    }

    private func queueNotification(count: Int) {
        guard notificationsEnabled, !shuttingDown else { return }
        notificationCount += count
        if notificationTask == nil { rescheduleNotification() }
    }

    private func rescheduleNotification() {
        notificationTask?.cancel()
        notificationTask = nil
        guard notificationsEnabled, notificationCount > 0, !shuttingDown else { return }
        let delay = notificationInterval
        notificationTask = Task { [weak self] in
            do { try await Task.sleep(for: .seconds(delay)) } catch { return }
            guard let self else { return }
            let count = self.notificationCount
            self.notificationCount = 0
            self.notificationTask = nil
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            guard self.notificationsEnabled, !self.shuttingDown,
                settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }
            let content = UNMutableNotificationContent()
            content.title = "NFD → NFC 변환 완료"
            content.body = "\(count)건의 이름 변환·ZIP 저장을 완료했습니다."
            do { try await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) }
            catch { self.errorMessage = "알림을 보내지 못했습니다. \(error.localizedDescription)" }
        }
    }

    private func authorizedArchiveDirectory() throws -> URL {
        let documents = Self.userDocumentsDirectory
        let expected = documents.appendingPathComponent("NFD2NFC", isDirectory: true)
        if let saved = state.archiveDirectory {
            do {
                var stale = false
                let url = try URL(resolvingBookmarkData: saved.bookmarkData, options: [.withSecurityScope, .withoutUI],
                    relativeTo: nil, bookmarkDataIsStale: &stale)
                guard url.startAccessingSecurityScopedResource() else { throw Self.failure("저장 폴더 접근 권한이 만료되었습니다.") }
                var retained = false
                defer { if !retained { url.stopAccessingSecurityScopedResource() } }
                guard FileManager.default.fileExists(atPath: url.path),
                    url.standardizedFileURL.resolvingSymlinksInPath() == expected.standardizedFileURL.resolvingSymlinksInPath() else {
                    throw Self.failure("저장 폴더를 다시 허용해주세요.")
                }
                if stale {
                    state.archiveDirectory?.bookmarkData = try url.bookmarkData(options: .withSecurityScope,
                        includingResourceValuesForKeys: nil, relativeTo: nil)
                    save()
                }
                retained = true
                return url
            } catch {
                // A missing, moved, or revoked destination requires a new user grant.
                state.archiveDirectory = nil
                save()
            }
        }
        prepareForPanel?()
        let panel = NSOpenPanel()
        panel.title = "ZIP 저장 폴더 접근 허용"
        panel.message = "Documents 또는 Documents/NFD2NFC 폴더를 선택해주세요. ZIP은 Documents/NFD2NFC에만 저장합니다. 원본 파일은 변경하지 않습니다."
        panel.directoryURL = documents
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.canCreateDirectories = true
        panel.prompt = "저장 폴더 허용"
        guard panel.runModal() == .OK, let selected = panel.url else {
            throw NSError(domain: NSCocoaErrorDomain, code: NSUserCancelledError)
        }
        defer { selected.stopAccessingSecurityScopedResource() }
        let resolved = selected.standardizedFileURL.resolvingSymlinksInPath()
        guard resolved == documents.standardizedFileURL.resolvingSymlinksInPath()
            || resolved == expected.standardizedFileURL.resolvingSymlinksInPath() else {
            throw Self.failure("Documents 또는 Documents/NFD2NFC 폴더를 선택해야 합니다.")
        }
        try FileManager.default.createDirectory(at: expected, withIntermediateDirectories: true)
        let data = try expected.bookmarkData(options: .withSecurityScope, includingResourceValuesForKeys: nil, relativeTo: nil)
        state.archiveDirectory = WatchedDirectory(path: expected.path, bookmarkData: data)
        save()
        var stale = false
        let scoped = try URL(resolvingBookmarkData: data, options: .withSecurityScope, relativeTo: nil, bookmarkDataIsStale: &stale)
        guard scoped.startAccessingSecurityScopedResource() else { throw Self.failure("저장 폴더에 접근할 수 없습니다.") }
        return scoped
    }

    private static var userDocumentsDirectory: URL {
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home, isDirectory: true).appendingPathComponent("Documents", isDirectory: true)
    }

    private static func failure(_ message: String) -> Error {
        NSError(domain: "NFD2NFC", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
