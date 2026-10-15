import AppKit
import Carbon
import NormalizationCore
import SwiftUI
import UserNotifications

@main
@MainActor
enum NFD2NFCApplication {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var model: AppModel!
    private var mainWindow: NSWindow?
    private var statusItem: NSStatusItem?
    private let popover = NSPopover()
    private var localMonitor: Any?
    private var wakeObserver: NSObjectProtocol?
    private var terminating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        model = AppModel()
        model.visibilityChanged = { [weak self] in self?.applyVisibility() }
        model.windowRequested = { [weak self] tab in self?.showMainWindow(tab: tab) }
        model.prepareForPanel = { [weak self] in
            self?.closePopover()
            NSApp.activate(ignoringOtherApps: true)
        }
        installMainMenu()
        popover.behavior = .applicationDefined
        popover.animates = true
        popover.contentViewController = NSHostingController(rootView: MenuBarView(model: model))
        UNUserNotificationCenter.current().delegate = self
        applyVisibility()
        model.start()
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
            object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.model.becameActive() }
            }
        let launchedAtLogin = NSAppleEventManager.shared().currentAppleEvent?
            .paramDescriptor(forKeyword: AEKeyword(keyAEPropData))?
            .paramDescriptor(forKeyword: AEKeyword(keyAELaunchedAsLogInItem))?.booleanValue ?? false
        if !launchedAtLogin { showMainWindow(tab: .watching) }
    }

    func applicationDidBecomeActive(_ notification: Notification) { model?.becameActive() }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showMainWindow(tab: model?.selectedTab ?? .watching)
        return false
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminating else { return .terminateLater }
        terminating = true
        closePopover()
        Task {
            await model.shutdown()
            if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    private func applyVisibility() {
        NSApp.setActivationPolicy(model.hideDockIcon ? .accessory : .regular)
        if model.hideMenuBarIcon {
            closePopover()
            if let statusItem { NSStatusBar.system.removeStatusItem(statusItem) }
            statusItem = nil
        } else if statusItem == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            item.button?.image = NSImage(named: "StatusBarIcon")
            item.button?.image?.isTemplate = true
            item.button?.image?.size = NSSize(width: 18, height: 18)
            item.button?.toolTip = "NFD → NFC · 파일명 변환"
            item.button?.setAccessibilityLabel("NFD → NFC")
            item.button?.setAccessibilityIdentifier("menu.status")
            item.button?.target = self
            item.button?.action = #selector(togglePopover(_:))
            item.button?.sendAction(on: [.leftMouseUp, .rightMouseUp])
            statusItem = item
        }
    }

    private func showMainWindow(tab: AppTab) {
        closePopover()
        model.selectedTab = tab
        if mainWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 540),
                styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "NFD → NFC"
            window.isReleasedWhenClosed = false
            window.minSize = NSSize(width: 640, height: 440)
            window.contentView = NSHostingView(rootView: MainView(model: model))
            window.setContentSize(NSSize(width: 760, height: 540))
            window.center()
            window.setFrameAutosaveName("NFD2NFCMainWindow")
            mainWindow = window
        }
        mainWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func showSettings() { showMainWindow(tab: .general) }
    @objc private func showWatching() { showMainWindow(tab: .watching) }
    @objc private func showHistory() { showMainWindow(tab: .history) }

    @objc private func togglePopover(_ sender: Any?) {
        guard let button = statusItem?.button else { return }
        if NSApp.currentEvent?.type == .rightMouseUp {
            closePopover()
            let menu = NSMenu()
            menu.addItem(withTitle: "실시간 감시…", action: #selector(showWatching), keyEquivalent: "")
            menu.addItem(withTitle: "변환 기록…", action: #selector(showHistory), keyEquivalent: "")
            menu.addItem(withTitle: "설정…", action: #selector(showSettings), keyEquivalent: "")
            menu.addItem(.separator())
            menu.addItem(withTitle: "종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            for item in menu.items where item.action != #selector(NSApplication.terminate(_:)) { item.target = self }
            NSMenu.popUpContextMenu(menu, with: NSApp.currentEvent!, for: button)
            return
        }
        if popover.isShown { closePopover(); return }
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        popover.contentViewController?.view.window?.makeKey()
        // Keep the destination open while a file is picked up in Finder.
        popover.contentViewController?.view.window?.hidesOnDeactivate = false
        popover.contentViewController?.view.window?.level = .floating
        NSApp.activate(ignoringOtherApps: true)
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self, self.popover.isShown else { return event }
            if event.keyCode == 53 { self.closePopover(); return nil }
            return event
        }
    }

    private func closePopover() {
        popover.performClose(nil)
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        localMonitor = nil
    }

    private func installMainMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: "NFD2NFC")
        appMenu.addItem(withTitle: "NFD2NFC에 관하여", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "").target = NSApp
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "NFD → NFC 설정…", action: #selector(showSettings), keyEquivalent: ",").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "NFD2NFC 가리기", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "NFD2NFC 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "편집")
        edit.addItem(withTitle: "실행 취소", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "다시 실행", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "잘라내기", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "붙여넣기", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "전체 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in self?.showMainWindow(tab: .history) }
        completionHandler()
    }
}
