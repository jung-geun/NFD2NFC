import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { randomUUID } from 'crypto';
import { scan } from '../core/scanner';
import { normalizeEntry } from '../core/normalizer';
import * as store from './store';
import * as watcher from './watcher';
import type { WatchedDir, UndoEntry } from '../core/types';

export function registerIpcHandlers(): void {
  // ── 디렉토리 선택 ──
  ipcMain.handle('dialog:selectDirectory', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── 디렉토리 CRUD ──
  ipcMain.handle('dirs:list', async () => store.getDirs());

  ipcMain.handle('dirs:add', async (_e, dirPath: string) => {
    const settings = await store.getSettings();
    const dir: WatchedDir = {
      id: randomUUID(),
      path: dirPath,
      recursive: false,
      mode: settings.defaultMode,
      enabled: true,
      customRanges: [],
    };
    await store.addDir(dir);
    await watcher.startDir(dir);
    return dir;
  });

  ipcMain.handle('dirs:update', async (_e, id: string, patch: Partial<WatchedDir>) => {
    await store.updateDir(id, patch);
    // 모드/recursive 변경 시 재시작
    if ('mode' in patch || 'recursive' in patch || 'enabled' in patch || 'customRanges' in patch) {
      await watcher.stopDir(id);
      const dirs = await store.getDirs();
      const dir = dirs.find((d) => d.id === id);
      if (dir?.enabled) await watcher.startDir(dir);
    }
  });

  ipcMain.handle('dirs:remove', async (_e, id: string) => {
    await watcher.stopDir(id);
    await store.removeDir(id);
  });

  // ── Dry-run 스캔 ──
  ipcMain.handle('dirs:scan', async (_e, id: string) => {
    const dirs = await store.getDirs();
    const dir = dirs.find((d) => d.id === id);
    if (!dir) return [];
    return scan(dir.path, dir.recursive, { customRanges: dir.customRanges });
  });

  // ── 수동 모드 대기 큐 적용 ──
  ipcMain.handle('dirs:applyQueue', async (_e, id: string) => {
    const dirs = await store.getDirs();
    const dir = dirs.find((d) => d.id === id);
    if (!dir) return [];
    return watcher.applyManualQueue(id, dir);
  });

  ipcMain.handle('dirs:pendingQueue', async (_e, id: string) => {
    return watcher.getPendingQueue(id);
  });

  // ── 감시 일시정지/재개/상태 ──
  ipcMain.handle('watcher:status', () => ({ paused: watcher.isGloballyPaused() }));

  ipcMain.handle('watcher:pauseAll', async () => {
    await watcher.pauseAll();
  });

  ipcMain.handle('watcher:resumeAll', async () => {
    const dirs = await store.getDirs();
    await watcher.resumeAll(dirs);
  });

  // ── Undo ──
  ipcMain.handle('undo:list', async () => store.getUndoLog());

  ipcMain.handle('undo:revertEntry', async (_e, entry: UndoEntry) => {
    try {
      const result = await normalizeEntry(entry.newPath, 'file');
      // 실제 되돌리기: newPath → oldPath
      const fs = await import('fs/promises');
      await fs.rename(entry.newPath, entry.oldPath);
      await store.markUndoReverted([entry.id]);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('undo:revertLastBatch', async () => {
    const log = await store.getUndoLog();
    if (!log.length) return [];
    const lastTs = log[log.length - 1].ts;
    // 마지막 5초 이내의 항목을 한 배치로 묶음
    const batch = log.filter((e) => !e.reverted && lastTs - e.ts < 5000);
    const fs = await import('fs/promises');
    const results = [];
    for (const entry of [...batch].reverse()) {
      try {
        await fs.rename(entry.newPath, entry.oldPath);
        results.push({ ...entry, success: true });
      } catch (err) {
        results.push({ ...entry, success: false, error: String(err) });
      }
    }
    await store.markUndoReverted(batch.map((e) => e.id));
    return results;
  });

  // ── 설정 ──
  ipcMain.handle('settings:get', async () => store.getSettings());
  ipcMain.handle('settings:update', async (_e, patch) => store.updateSettings(patch));

  // ── 앱 정보 ──
  ipcMain.handle('app:version', () => app.getVersion());
}
