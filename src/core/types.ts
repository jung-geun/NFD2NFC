export type DirId = string;
export type WatchMode = 'auto' | 'manual';

export interface WatchedDir {
  id: DirId;
  path: string;
  recursive: boolean;
  mode: WatchMode;
  enabled: boolean;
  customRanges: Array<[number, number]>;
}

export interface RenameResult {
  type: 'file' | 'directory';
  oldPath: string;
  newPath: string;
  status: 'renamed' | 'noop-same-inode' | 'collision' | 'skipped';
}

export interface UndoEntry {
  id: string;
  ts: number;
  oldPath: string;
  newPath: string;
  reverted: boolean;
}

export interface ActivityEvent {
  type: 'rename' | 'error' | 'collision' | 'info';
  ts: number;
  dirId: DirId;
  message: string;
  result?: RenameResult;
}

export interface AppSettings {
  startAtLogin: boolean;
  defaultMode: WatchMode;
  notificationsEnabled: boolean;
  notificationIntervalSecs: number; // 배치 알림 인터벌 (초), 기본 30
}

export interface AppSchema {
  watchedDirs: WatchedDir[];
  settings: AppSettings;
  undoLog: UndoEntry[];
}
