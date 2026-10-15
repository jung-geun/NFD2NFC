import AppKit
import SwiftUI
import NormalizationCore

@MainActor
struct MainView: View {
    @ObservedObject var model: AppModel
    private static let supportURL = URL(string: "https://nfd2nfc.com/support/")!
    private static let privacyPolicyURL = URL(string: "https://nfd2nfc.com/privacy/")!

    var body: some View {
        TabView(selection: $model.selectedTab) {
            watchingTab
                .tabItem { Label("실시간 감시", systemImage: "folder.badge.gearshape") }
                .tag(AppTab.watching)

            historyTab
                .tabItem { Label("변환 기록", systemImage: "clock.arrow.circlepath") }
                .tag(AppTab.history)

            generalTab
                .tabItem { Label("일반", systemImage: "gearshape") }
                .tag(AppTab.general)
        }
        .padding(16)
        .frame(minWidth: 640, idealWidth: 760, minHeight: 440, idealHeight: 540)
        .alert("작업을 완료하지 못했습니다", isPresented: errorIsPresented) {
            Button("확인", role: .cancel) { model.errorMessage = nil }
        } message: {
            Text(model.errorMessage ?? "")
        }
    }

    private var errorIsPresented: Binding<Bool> {
        Binding(
            get: { model.errorMessage != nil },
            set: { if !$0 { model.errorMessage = nil } }
        )
    }

    private var watchingTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("실시간 감시")
                        .font(.title2.bold())
                    Text("추가한 폴더와 모든 하위 폴더의 한글 파일·폴더 이름을 자동으로 NFC로 변환합니다.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 16)
                Button(action: model.chooseDirectories) {
                    Label("폴더 추가…", systemImage: "folder.badge.plus")
                }
                .keyboardShortcut("o", modifiers: [.command, .shift])
                .accessibilityIdentifier("watch.add")
            }

            if model.directories.isEmpty {
                emptyState(
                    title: "감시 폴더가 없습니다",
                    description: "‘폴더 추가’를 눌러 자동으로 이름을 변환할 폴더를 선택하세요.",
                    symbol: "folder"
                )
            } else {
                List {
                    ForEach(model.directories) { directory in
                        directoryRow(directory)
                    }
                }
                .listStyle(.inset)
                .accessibilityIdentifier("watch.directories")
            }

            Text("선택한 최상위 폴더 이름은 유지하며, 숨김 항목과 심볼릭 링크는 건너뜁니다.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
    }

    private func directoryRow(_ directory: WatchedDirectory) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "folder")
                .foregroundStyle(.secondary)
                .padding(.top, 3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(URL(fileURLWithPath: directory.path).lastPathComponent)
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(directory.path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .help(directory.path)
                if let error = model.directoryErrors[directory.id] {
                    Label("감시 오류: \(error)", systemImage: "exclamationmark.triangle")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("접근 권한이 만료되었다면 제거하지 말고 ‘폴더 추가’에서 이 폴더를 다시 선택하세요.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            Button("열기") { model.openDirectory(directory) }
                .help("Finder에서 폴더 열기")
                .accessibilityLabel("\(URL(fileURLWithPath: directory.path).lastPathComponent) 폴더 열기")
                .accessibilityIdentifier("watch.open.\(directory.id.uuidString)")
            Button("제거") { model.removeDirectory(directory) }
                .help("감시 목록에서만 제거합니다. 폴더는 삭제하지 않습니다.")
                .accessibilityLabel("\(URL(fileURLWithPath: directory.path).lastPathComponent) 감시 제거")
                .accessibilityIdentifier("watch.remove.\(directory.id.uuidString)")
        }
        .padding(.vertical, 6)
        .buttonStyle(.bordered)
    }

    private var historyTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("변환 기록")
                    .font(.title2.bold())
                Spacer()
                Text("\(model.history.count)개 · 최근 최대 1,000개")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("파일 이름 변환은 항목별로 되돌릴 수 있습니다. ZIP 내부 이름 변환은 원본을 변경하지 않습니다.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            if model.history.isEmpty {
                emptyState(
                    title: "변환 기록이 없습니다",
                    description: "감시 폴더에서 이름이 변환되거나 ZIP을 만들면 여기에 표시됩니다.",
                    symbol: "clock"
                )
            } else {
                List {
                    ForEach(model.history) { record in
                        historyRow(record)
                    }
                }
                .listStyle(.inset)
                .accessibilityIdentifier("history.records")
            }
        }
        .padding(16)
    }

    private func historyRow(_ record: ConversionRecord) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: record.kind == .archive ? "doc.zipper" : (record.isDirectory ? "folder" : "doc"))
                .foregroundStyle(.secondary)
                .padding(.top, 3)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(URL(fileURLWithPath: record.currentPath).lastPathComponent)
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(record.currentPath)
                Text(AppModel.abbreviatedParentPath(record.currentPath))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(URL(fileURLWithPath: record.currentPath).deletingLastPathComponent().path)
                HStack(spacing: 8) {
                    Text(record.kind == .archive ? "ZIP 내부 이름 변환" : "파일 이름 변환")
                    Text(record.date, format: .dateTime.year().month().day().hour().minute().second())
                    if record.reverted {
                        Label("되돌림 완료", systemImage: "arrow.uturn.backward")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 8) {
                    Button { model.reveal(record) } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .help("Finder에서 보기")
                    .accessibilityLabel("Finder에서 보기")
                    .accessibilityIdentifier("history.reveal.\(record.id.uuidString)")
                    Button { model.copyPath(record) } label: {
                        Image(systemName: "doc.on.doc")
                    }
                    .help("전체 경로 복사")
                    .accessibilityLabel("전체 경로 복사")
                    .accessibilityIdentifier("history.copy.\(record.id.uuidString)")
                }
                if record.kind == .rename && !record.reverted {
                    HStack(spacing: 6) {
                        if model.revertingIDs.contains(record.id) {
                            ProgressView()
                                .controlSize(.small)
                                .accessibilityLabel("이름 되돌리는 중")
                        }
                        Button("되돌리기") { model.revert(record) }
                            .disabled(record.identity == nil || model.revertingIDs.contains(record.id))
                            .help(record.identity == nil ? "파일 식별 정보가 없어 안전하게 되돌릴 수 없습니다." : "원래 파일 이름으로 되돌리기")
                            .accessibilityIdentifier("history.revert.\(record.id.uuidString)")
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .buttonStyle(.bordered)
        .contextMenu {
            Button("Finder에서 보기") { model.reveal(record) }
            Button("전체 경로 복사") { model.copyPath(record) }
            if record.kind == .rename && !record.reverted {
                Divider()
                Button("이름 되돌리기") { model.revert(record) }
                    .disabled(record.identity == nil || model.revertingIDs.contains(record.id))
            }
        }
    }

    private var generalTab: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    Image("BrandIcon")
                        .resizable()
                        .frame(width: 48, height: 48)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("NFD → NFC")
                            .font(.title3.bold())
                        Text("한글 파일명 정규화")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
            Section("지원 및 개인정보") {
                HStack {
                    Link("지원 및 문의", destination: Self.supportURL)
                        .accessibilityIdentifier("settings.support")
                    Spacer()
                    Link("개인정보 처리방침", destination: Self.privacyPolicyURL)
                        .accessibilityIdentifier("settings.privacy")
                }
            }
            Section("알림") {
                Toggle("변환 알림 받기", isOn: $model.notificationsEnabled)
                    .accessibilityIdentifier("settings.notifications")
                HStack {
                    Text("알림 간격")
                    Spacer()
                    TextField("초", value: notificationInterval, format: .number.grouping(.never))
                        .multilineTextAlignment(.trailing)
                        .frame(width: 64)
                        .accessibilityLabel("알림 간격, 초")
                        .accessibilityIdentifier("settings.notificationInterval")
                    Text("초")
                    Stepper("알림 간격", value: notificationInterval, in: 1...Int.max)
                        .labelsHidden()
                        .accessibilityLabel("알림 간격 조절")
                }
                .disabled(!model.notificationsEnabled)
                Text("지정한 초 간격으로 변환 결과를 모아 알립니다. 최소 1초입니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if model.notificationsDenied {
                    Text("시스템에서 알림이 허용되지 않았습니다. 시스템 설정에서 NFD2NFC 알림을 허용하세요.")
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("알림 설정 열기", action: model.openNotificationSettings)
                        .accessibilityIdentifier("settings.openNotifications")
                }
            }
            Section("앱 표시") {
                Toggle("Dock 아이콘 숨기기", isOn: $model.hideDockIcon)
                    .accessibilityIdentifier("settings.hideDock")
                Toggle("메뉴 막대 아이콘 숨기기", isOn: $model.hideMenuBarIcon)
                    .accessibilityIdentifier("settings.hideMenuBar")
                Text(model.hideDockIcon && model.hideMenuBarIcon
                     ? "두 아이콘이 모두 숨겨져 있습니다. 앱은 계속 실행됩니다. 창을 닫은 뒤 다시 설정하려면 Finder의 응용 프로그램에서 NFD2NFC를 여세요."
                     : "아이콘은 각각 숨길 수 있습니다. 아이콘을 모두 숨겨도 앱은 계속 실행되며, Finder의 응용 프로그램에서 NFD2NFC를 다시 열면 설정 창을 볼 수 있습니다.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Section("시작") {
                Toggle("로그인 시 자동 실행", isOn: Binding(
                    get: { model.launchAtLogin },
                    set: { model.setLaunchAtLogin($0) }
                ))
                .accessibilityIdentifier("settings.launchAtLogin")
                if model.loginRequiresApproval {
                    Text("로그인 항목 승인이 필요합니다. 시스템 설정에서 NFD2NFC를 허용하세요.")
                        .font(.callout)
                        .fixedSize(horizontal: false, vertical: true)
                    Button("로그인 항목 설정 열기", action: model.openLoginItemsSettings)
                        .accessibilityIdentifier("settings.openLoginItems")
                } else {
                    Text(model.launchAtLogin ? "시스템에 로그인 항목으로 등록되어 있습니다." : "로그인 시 자동으로 실행하지 않습니다.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
    }

    private var notificationInterval: Binding<Int> {
        Binding(
            get: { model.notificationInterval },
            set: { model.notificationInterval = max(1, $0) }
        )
    }

    private func emptyState(title: String, description: String, symbol: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(title)
                .font(.headline)
            Text(description)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(24)
    }
}
