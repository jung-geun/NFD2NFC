import Foundation
import NormalizationCore

struct AppPreferences: Codable {
    var notificationsEnabled = true
    var notificationInterval = 30
    var hideDockIcon = true
    var hideMenuBarIcon = false
}

struct SavedState: Codable {
    var preferences = AppPreferences()
    var directories: [WatchedDirectory] = []
    var history: [ConversionRecord] = []
    var exclusions: [RevertedName] = []
    var archiveDirectory: WatchedDirectory?
}

final class StateStore: @unchecked Sendable {
    private let url: URL
    private let queue = DispatchQueue(label: "com.pieroot.nfd2nfc.persistence", qos: .utility)
    private var pending: SavedState?
    private var scheduled: DispatchWorkItem?
    var onError: (@Sendable (Error) -> Void)?

    init(url: URL? = nil) {
        self.url = url ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("NFD2NFC", isDirectory: true)
            .appendingPathComponent("state.json")
    }

    func load() throws -> SavedState {
        guard FileManager.default.fileExists(atPath: url.path) else { return SavedState() }
        return try JSONDecoder().decode(SavedState.self, from: Data(contentsOf: url))
    }

    func scheduleSave(_ state: SavedState) {
        queue.async {
            self.pending = state
            guard self.scheduled == nil else { return }
            let work = DispatchWorkItem {
                self.scheduled = nil
                self.savePending()
            }
            self.scheduled = work
            self.queue.asyncAfter(deadline: .now() + 0.5, execute: work)
        }
    }

    func flush() {
        queue.sync {
            scheduled?.cancel()
            scheduled = nil
            savePending()
        }
    }

    private func savePending() {
        guard let state = pending else { return }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(state)
            try data.write(to: url, options: .atomic)
            pending = nil
        } catch {
            onError?(error)
        }
    }
}
