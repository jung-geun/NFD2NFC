import { contextBridge, ipcRenderer } from 'electron';
import type { WatchedDir, UndoEntry, AppSettings, ActivityEvent } from '../core/types';

contextBridge.exposeInMainWorld('api', {
  // 디렉토리 관리
  dirs: {
    list: (): Promise<WatchedDir[]> => ipcRenderer.invoke('dirs:list'),
    add: (path: string): Promise<WatchedDir> => ipcRenderer.invoke('dirs:add', path),
    update: (id: string, patch: Partial<WatchedDir>) => ipcRenderer.invoke('dirs:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('dirs:remove', id),
    scan: (id: string) => ipcRenderer.invoke('dirs:scan', id),
    applyQueue: (id: string) => ipcRenderer.invoke('dirs:applyQueue', id),
    pendingQueue: (id: string) => ipcRenderer.invoke('dirs:pendingQueue', id),
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),
  },

  // 감시 제어
  watcher: {
    status: (): Promise<{ paused: boolean }> => ipcRenderer.invoke('watcher:status'),
    pauseAll: () => ipcRenderer.invoke('watcher:pauseAll'),
    resumeAll: () => ipcRenderer.invoke('watcher:resumeAll'),
  },

  // Undo
  undo: {
    list: (): Promise<UndoEntry[]> => ipcRenderer.invoke('undo:list'),
    revertEntry: (entry: UndoEntry) => ipcRenderer.invoke('undo:revertEntry', entry),
    revertLastBatch: () => ipcRenderer.invoke('undo:revertLastBatch'),
  },

  // 설정
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    update: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),
  },

  // 이벤트 (main → renderer 푸시)
  events: {
    onActivity: (cb: (event: ActivityEvent) => void) => {
      const handler = (_: unknown, event: ActivityEvent) => cb(event);
      ipcRenderer.on('watcher:activity', handler);
      return () => ipcRenderer.removeListener('watcher:activity', handler);
    },
    // 일시정지 상태 변경 (트레이 컨텍스트 메뉴 포함 모든 경로에서 발생)
    onPausedChange: (cb: (paused: boolean) => void) => {
      const handler = (_: unknown, paused: boolean) => cb(paused);
      ipcRenderer.on('watcher:paused', handler);
      return () => ipcRenderer.removeListener('watcher:paused', handler);
    },
  },

  app: {
    version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  },
});
