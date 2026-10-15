import Foundation

public struct FileIdentity: Codable, Hashable, Sendable {
    public var device: UInt64
    public var inode: UInt64

    public init(device: UInt64, inode: UInt64) {
        self.device = device
        self.inode = inode
    }
}

public enum ConversionKind: String, Codable, Sendable {
    case rename, archive
}

public struct ConversionRecord: Codable, Identifiable, Sendable {
    public var id: UUID
    public var date: Date
    public var rootID: UUID?
    public var originalPath: String
    public var currentPath: String
    public var isDirectory: Bool
    public var identity: FileIdentity?
    public var reverted: Bool
    public var kind: ConversionKind

    public init(id: UUID = UUID(), date: Date = Date(), rootID: UUID?, originalPath: String,
                currentPath: String, isDirectory: Bool, identity: FileIdentity?,
                reverted: Bool = false, kind: ConversionKind = .rename) {
        self.id = id
        self.date = date
        self.rootID = rootID
        self.originalPath = originalPath
        self.currentPath = currentPath
        self.isDirectory = isDirectory
        self.identity = identity
        self.reverted = reverted
        self.kind = kind
    }
}

public struct RevertedName: Codable, Sendable {
    public var identity: FileIdentity
    public var name: String
    public var rootID: UUID?

    public init(identity: FileIdentity, name: String, rootID: UUID?) {
        self.identity = identity
        self.name = name
        self.rootID = rootID
    }
}

public struct WatchRoot: Sendable, Equatable {
    public var id: UUID
    public var url: URL

    public init(id: UUID, url: URL) {
        self.id = id
        self.url = url
    }
}

public struct MonitorIssue: Sendable {
    public var rootID: UUID?
    public var path: String
    public var message: String

    public init(rootID: UUID?, path: String, message: String) {
        self.rootID = rootID
        self.path = path
        self.message = message
    }
}

public struct ConversionBatch: Sendable {
    public var records: [ConversionRecord]
    public var issues: [MonitorIssue]

    public init(records: [ConversionRecord] = [], issues: [MonitorIssue] = []) {
        self.records = records
        self.issues = issues
    }
}

public struct WatchedDirectory: Codable, Identifiable, Sendable {
    public var id: UUID
    public var path: String
    public var bookmarkData: Data

    public init(id: UUID = UUID(), path: String, bookmarkData: Data) {
        self.id = id
        self.path = path
        self.bookmarkData = bookmarkData
    }
}

public struct ArchiveProgress: Sendable {
    public var filesProcessed: Int
    public var bytesProcessed: UInt64
    public var currentName: String

    public init(filesProcessed: Int, bytesProcessed: UInt64, currentName: String) {
        self.filesProcessed = filesProcessed
        self.bytesProcessed = bytesProcessed
        self.currentName = currentName
    }
}

public struct ArchiveResult: Sendable {
    public var url: URL
    public var entryCount: Int
    public var convertedNameCount: Int
    public var bytesRead: UInt64

    public init(url: URL, entryCount: Int, convertedNameCount: Int, bytesRead: UInt64) {
        self.url = url
        self.entryCount = entryCount
        self.convertedNameCount = convertedNameCount
        self.bytesRead = bytesRead
    }
}
