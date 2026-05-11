import fs from 'fs/promises';
import chokidar, { FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import { nanoid } from './nanoid';
import { shouldNormalize } from '../core/filter';
import { normalizeEntry } from '../core/normalizer';
import type { WatchedDir, ActivityEvent, RenameResult } from '../core/types';
import * as store from './store';
import * as notifier from './notifier';

type ActivityListener = (event: ActivityEvent) => void;

const watchers = new Map<string, FSWatcher>();
const recentlyRenamed = new Map<string, number>();
const RENAME_TTL = 2000;
const listeners = new Set<ActivityListener>();
const manualQueue = new Map<string, string[]>();

// 전역 일시정지 상태 — 단일 진실의 원천
let globallyPaused = false;

export function isGloballyPaused(): boolean {
  return globallyPaused;
}

export function onActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ActivityEvent): void {
  for (const l of listeners) l(event);
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('watcher:activity', event);
  });
}

// 일시정지 상태 변경을 렌더러에 브로드캐스트
function emitPauseState(): void {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) w.webContents.send('watcher:paused', globallyPaused);
  });
}

export async function startDir(dir: WatchedDir): Promise<void> {
  if (watchers.has(dir.id)) return;

  const filterOpts = { customRanges: dir.customRanges };
  const w = chokidar.watch(dir.path, {
    ignoreInitial: false,
    persistent: true,
    depth: dir.recursive ? undefined : 0,
    ignored: /(^|[/\\])\../,
  });

  async function handlePath(filePath: string, type: 'file' | 'directory'): Promise<void> {
    const now = Date.now();
    const lastRenamed = recentlyRenamed.get(filePath);
    if (lastRenamed && now - lastRenamed < RENAME_TTL) return;

    const basename = filePath.split('/').pop() ?? '';
    if (!shouldNormalize(basename, filterOpts)) return;

    if (dir.mode === 'auto') {
      const result = await normalizeEntry(filePath, type, filterOpts);
      if (result.status === 'renamed' || result.status === 'noop-same-inode') {
        recentlyRenamed.set(result.newPath, Date.now());
        if (result.status === 'renamed') {
          await store.appendUndoEntries([
            { id: nanoid(), ts: now, oldPath: result.oldPath, newPath: result.newPath, reverted: false },
          ]);
        }
        emit({ type: 'rename', ts: now, dirId: dir.id, message: `${result.oldPath} → ${result.newPath}`, result });
        // 알림은 배치로 처리 — 인터벌마다 총 건수 발송
        await notifier.queueRenamedNotification(dir.path);
      } else if (result.status === 'collision') {
        emit({ type: 'collision', ts: now, dirId: dir.id, message: `충돌: ${result.oldPath}`, result });
      }
    } else {
      const queue = manualQueue.get(dir.id) ?? [];
      if (!queue.includes(filePath)) {
        queue.push(filePath);
        manualQueue.set(dir.id, queue);
        emit({ type: 'info', ts: now, dirId: dir.id, message: `수동 대기: ${filePath}` });
      }
      await notifier.notifyManualQueue(queue.length, dir.path);
    }
  }

  w.on('add', (p) => handlePath(p, 'file').catch(console.error))
    .on('addDir', (p) => {
      if (p === dir.path) return;
      handlePath(p, 'directory').catch(console.error);
    })
    .on('error', (err) => {
      emit({ type: 'error', ts: Date.now(), dirId: dir.id, message: String(err) });
    });

  watchers.set(dir.id, w);
}

export async function stopDir(dirId: string): Promise<void> {
  const w = watchers.get(dirId);
  if (!w) return;
  await w.close();
  watchers.delete(dirId);
  manualQueue.delete(dirId);
}

/** 전역 일시정지: 모든 감시 중단 + 상태 플래그 변경 */
export async function pauseAll(): Promise<void> {
  globallyPaused = true;
  for (const [id] of [...watchers]) await stopDir(id);
  emitPauseState();
}

/** 전역 재개: 지정된 dirs로 감시 재시작 + 상태 플래그 변경 */
export async function resumeAll(dirs: WatchedDir[]): Promise<void> {
  globallyPaused = false;
  for (const d of dirs.filter((x) => x.enabled)) {
    await startDir(d);
  }
  emitPauseState();
}

/** 앱 종료용 정리 — 일시정지 플래그 변경 없음 */
export async function stopAll(): Promise<void> {
  for (const [id] of [...watchers]) await stopDir(id);
}

export function getPendingQueue(dirId: string): string[] {
  return manualQueue.get(dirId) ?? [];
}

export async function applyManualQueue(dirId: string, dir: WatchedDir): Promise<RenameResult[]> {
  const queue = manualQueue.get(dirId) ?? [];
  const filterOpts = { customRanges: dir.customRanges };
  const results: RenameResult[] = [];
  const undoEntries = [];
  const now = Date.now();

  for (const filePath of queue) {
    try {
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) continue;
      const type = stat.isDirectory() ? 'directory' : 'file';
      const result = await normalizeEntry(filePath, type, filterOpts);
      results.push(result);
      if (result.status === 'renamed') {
        recentlyRenamed.set(result.newPath, Date.now());
        undoEntries.push({ id: nanoid(), ts: now, oldPath: result.oldPath, newPath: result.newPath, reverted: false });
      }
    } catch (err) {
      console.error('applyManualQueue error:', err);
    }
  }

  manualQueue.set(dirId, []);
  if (undoEntries.length) await store.appendUndoEntries(undoEntries);
  // 수동 적용은 즉시 배치에 추가 (인터벌 내 합산)
  const renamedCount = results.filter((r) => r.status === 'renamed').length;
  for (let i = 0; i < renamedCount; i++) await notifier.queueRenamedNotification(dir.path);
  return results;
}
