import Foundation
import NormalizationCore

// Runs real app state logic without launching the app or opening user folders.
@main
struct AppModelSmoke {
    @MainActor static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("NFD2NFCSettings-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = StateStore(url: directory.appendingPathComponent("state.json"))
        let model = AppModel(store: store)
        model.notificationInterval = 7
        precondition(model.notificationInterval == 7, "A valid interval must not reenter its Published setter")
        model.notificationInterval = 0
        precondition(model.notificationInterval == 1, "An invalid interval must clamp without recursion")
        model.notificationInterval = 7
        await model.shutdown()
        let saved = try store.load()
        precondition(saved.preferences.notificationInterval == 7, "The edited interval must survive persistence")
        print("App model regression passed: interval edit, minimum bound and persistence")
    }
}
