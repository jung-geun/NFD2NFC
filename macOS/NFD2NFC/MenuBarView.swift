import AppKit
import SwiftUI

@MainActor
struct MenuBarView: View {
    @ObservedObject var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image("BrandMark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
                    .accessibilityHidden(true)
                Text("NFD2NFC")
                    .font(.headline)
                Spacer()
                Text(model.archiveIsRunning ? "ZIP 생성 중" : "ZIP 내부 이름 변환")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack {
                Text("실시간 감시 · \(model.directories.count)개 폴더")
                    .font(.subheadline)
                Spacer()
                Button("관리…") { model.showMainWindow(tab: .watching) }
                    .accessibilityIdentifier("menu.watching")
            }
            if !model.directories.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(model.directories) { directory in
                            HStack(spacing: 8) {
                                Image(systemName: model.directoryErrors[directory.id] == nil ? "folder" : "exclamationmark.triangle")
                                    .foregroundStyle(.secondary)
                                Text(URL(fileURLWithPath: directory.path).lastPathComponent)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .help(model.directoryErrors[directory.id] ?? directory.path)
                                Spacer(minLength: 4)
                                Button("열기") { model.openDirectory(directory) }
                                    .help("Finder에서 폴더 열기")
                                Button("제거") { model.removeDirectory(directory) }
                                    .help("폴더를 삭제하지 않고 감시만 중단합니다.")
                            }
                            .font(.callout)
                        }
                    }
                }
                .frame(height: min(CGFloat(model.directories.count) * 32, 108))
            }
            Divider()

            NativeFileDropTarget(isBusy: model.archiveIsRunning) { urls in
                // Keep this call synchronous: AppModel retains security scopes before the drag ends.
                model.archiveFiles(urls)
            }
            .frame(height: 110)
            .accessibilityIdentifier("archive.drop")

            Button(action: model.chooseArchiveFiles) {
                Label("파일 또는 폴더 선택…", systemImage: "doc.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .disabled(model.archiveIsRunning)
            .keyboardShortcut("o", modifiers: .command)
            .accessibilityIdentifier("archive.choose")

            Text("ZIP 내부의 한글 이름만 NFC로 변환합니다. 원본 파일과 폴더는 변경하지 않습니다.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("저장 위치: ~/Documents/NFD2NFC")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

            if model.archiveIsRunning {
                HStack(alignment: .top, spacing: 10) {
                    ProgressView()
                        .controlSize(.small)
                        .accessibilityLabel("ZIP 생성 중")
                    VStack(alignment: .leading, spacing: 4) {
                        if let progress = model.archiveProgress {
                            Text("\(progress.filesProcessed)개 처리 · \(byteCount(progress.bytesProcessed)) 읽음")
                                .font(.callout)
                                .accessibilityIdentifier("archive.progress")
                            if !progress.currentName.isEmpty {
                                Text(progress.currentName)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .help(progress.currentName)
                            }
                        } else {
                            Text("ZIP 생성을 준비하고 있습니다…")
                                .font(.callout)
                        }
                    }
                }
            }

            if !model.archiveStatus.isEmpty {
                Text(model.archiveStatus)
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("archive.status")
            }

            if let error = model.errorMessage {
                VStack(alignment: .leading, spacing: 6) {
                    ScrollView {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .font(.callout)
                            .foregroundStyle(.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 80)
                    Button("오류 닫기") { model.errorMessage = nil }
                        .accessibilityIdentifier("archive.dismissError")
                }
            }

            if let archive = model.lastArchiveURL {
                VStack(alignment: .leading, spacing: 6) {
                    Text("마지막 ZIP: \(archive.lastPathComponent)")
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .help(archive.path)
                    Button(action: model.revealLastArchive) {
                        Label("마지막 ZIP을 Finder에서 보기", systemImage: "magnifyingglass")
                    }
                    .accessibilityIdentifier("archive.revealLast")
                }
            }
            Button(action: model.openArchiveFolder) {
                Label("출력 폴더 열기", systemImage: "folder")
            }
            .accessibilityIdentifier("archive.openOutput")

            Divider()
            HStack {
                Button {
                    model.showMainWindow(tab: .general)
                } label: {
                    Label("설정…", systemImage: "gearshape")
                }
                .keyboardShortcut(",", modifiers: .command)
                .accessibilityIdentifier("menu.settings")
                Spacer()
                Button("종료", action: model.quit)
                    .keyboardShortcut("q", modifiers: .command)
                    .accessibilityIdentifier("menu.quit")
            }
        }
        .padding(16)
        .frame(width: 360)
    }

    private func byteCount(_ bytes: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(clamping: bytes), countStyle: .file)
    }
}

@MainActor
private struct NativeFileDropTarget: NSViewRepresentable {
    var isBusy: Bool
    var onDrop: @MainActor ([URL]) -> Void

    func makeNSView(context: Context) -> FileDropView {
        let view = FileDropView(frame: .zero)
        view.isBusy = isBusy
        view.onDrop = onDrop
        return view
    }

    func updateNSView(_ nsView: FileDropView, context: Context) {
        nsView.isBusy = isBusy
        nsView.onDrop = onDrop
    }
}

// NSView implements the NSDraggingDestination callbacks. Reading NSURL objects rather
// than strings or asynchronous item providers preserves the sandbox's pasteboard grants.
@MainActor
private final class FileDropView: NSBox {
    var onDrop: (@MainActor ([URL]) -> Void)?
    var isBusy = false {
        didSet {
            if isBusy { isReceivingDrag = false }
            updateAppearance()
        }
    }
    private var isReceivingDrag = false {
        didSet { updateAppearance() }
    }
    private let heading = NSTextField(labelWithString: "파일 또는 폴더를 여기에 놓으세요")
    private let detail = NSTextField(labelWithString: "ZIP 내부 이름만 변환")

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        title = ""
        titlePosition = .noTitle
        boxType = .custom
        cornerRadius = 6
        contentViewMargins = NSSize(width: 12, height: 12)
        registerForDraggedTypes([.fileURL])

        let image = NSImageView()
        image.image = NSImage(systemSymbolName: "doc.zipper", accessibilityDescription: nil)
        image.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 24, weight: .regular)
        image.setAccessibilityElement(false)
        heading.font = .systemFont(ofSize: NSFont.systemFontSize, weight: .medium)
        heading.alignment = .center
        detail.font = .systemFont(ofSize: NSFont.smallSystemFontSize)
        detail.textColor = .secondaryLabelColor
        detail.alignment = .center

        let stack = NSStackView(views: [image, heading, detail])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        if let contentView {
            contentView.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: contentView.centerXAnchor),
                stack.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
                stack.leadingAnchor.constraint(greaterThanOrEqualTo: contentView.leadingAnchor),
                stack.trailingAnchor.constraint(lessThanOrEqualTo: contentView.trailingAnchor)
            ])
        }
        setAccessibilityElement(true)
        setAccessibilityRole(.group)
        setAccessibilityIdentifier("archive.drop")
        setAccessibilityHelp("파일 또는 폴더를 놓거나 파일 또는 폴더 선택 버튼을 사용하세요. 원본은 변경되지 않습니다.")
        updateAppearance()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        updateDrag(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        updateDrag(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        isReceivingDrag = false
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        !isBusy && onDrop != nil && localFileURLs(from: sender.draggingPasteboard) != nil
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        defer { isReceivingDrag = false }
        guard !isBusy,
              let onDrop,
              let urls = localFileURLs(from: sender.draggingPasteboard) else { return false }
        // Do not use Task, dispatch, or SwiftUI onDrop here. Scope acquisition must
        // start within this AppKit callback, before the pasteboard grant expires.
        onDrop(urls)
        return true
    }

    override func concludeDragOperation(_ sender: NSDraggingInfo?) {
        isReceivingDrag = false
    }

    private func updateDrag(_ sender: NSDraggingInfo) -> NSDragOperation {
        // Finder may advertise a modifier-dependent move mask. We never move
        // sources: accepted local URLs are read to create a separate ZIP.
        let accepts = !isBusy && onDrop != nil
            && localFileURLs(from: sender.draggingPasteboard) != nil
        isReceivingDrag = accepts
        return accepts ? .copy : []
    }

    private func localFileURLs(from pasteboard: NSPasteboard) -> [URL]? {
        guard let objects = pasteboard.readObjects(
            forClasses: [NSURL.self],
            options: [.urlReadingFileURLsOnly: true]
        ) as? [NSURL], !objects.isEmpty else { return nil }

        let urls = objects.map { $0 as URL }
        guard urls.allSatisfy({ url in
            let host = url.host ?? ""
            return url.isFileURL && url.path.hasPrefix("/")
                && (host.isEmpty || host.lowercased() == "localhost")
        }) else { return nil }
        return urls
    }

    private func updateAppearance() {
        borderColor = isReceivingDrag ? .controlAccentColor : .separatorColor
        fillColor = isReceivingDrag
            ? NSColor.controlAccentColor.withAlphaComponent(0.08)
            : .controlBackgroundColor
        heading.stringValue = isBusy ? "ZIP을 생성하고 있습니다…" : "파일 또는 폴더를 여기에 놓으세요"
        detail.stringValue = isBusy ? "완료 후 다시 놓을 수 있습니다" : "ZIP 내부 이름만 변환"
        heading.textColor = isBusy ? .secondaryLabelColor : .labelColor
        setAccessibilityLabel(isBusy ? "ZIP 생성 중. 파일 드롭을 사용할 수 없습니다." : "ZIP 생성 파일 드롭 영역")
    }
}
