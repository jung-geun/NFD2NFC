import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { AppSchema, AppSettings, WatchedDir, UndoEntry } from '../core/types';

const STORE_PATH = path.join(app.getPath('userData'), 'store.json');
const MAX_UNDO_LOG = 1000;

const DEFAULT_SETTINGS: AppSettings = {
  startAtLogin: false,
  defaultMode: 'auto',
  notificationsEnabled: true,
};

const DEFAULT_SCHEMA: AppSchema = {
  watchedDirs: [],
  settings: DEFAULT_SETTINGS,
  undoLog: [],
};

let cache: AppSchema | null = null;

async function load(): Promise<AppSchema> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    cache = { ...DEFAULT_SCHEMA, ...JSON.parse(raw) };
  } catch {
    cache = structuredClone(DEFAULT_SCHEMA);
  }
  return cache!;
}

async function save(): Promise<void> {
  if (!cache) return;
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

export async function getDirs(): Promise<WatchedDir[]> {
  return (await load()).watchedDirs;
}

export async function addDir(dir: WatchedDir): Promise<void> {
  const data = await load();
  data.watchedDirs.push(dir);
  await save();
}

export async function updateDir(id: string, patch: Partial<WatchedDir>): Promise<void> {
  const data = await load();
  const idx = data.watchedDirs.findIndex((d) => d.id === id);
  if (idx === -1) return;
  data.watchedDirs[idx] = { ...data.watchedDirs[idx], ...patch };
  await save();
}

export async function removeDir(id: string): Promise<void> {
  const data = await load();
  data.watchedDirs = data.watchedDirs.filter((d) => d.id !== id);
  await save();
}

export async function getSettings(): Promise<AppSettings> {
  return (await load()).settings;
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const data = await load();
  data.settings = { ...data.settings, ...patch };
  await save();
}

export async function appendUndoEntries(entries: UndoEntry[]): Promise<void> {
  const data = await load();
  data.undoLog.push(...entries);
  if (data.undoLog.length > MAX_UNDO_LOG) {
    data.undoLog = data.undoLog.slice(-MAX_UNDO_LOG);
  }
  await save();
}

export async function getUndoLog(): Promise<UndoEntry[]> {
  return (await load()).undoLog;
}

export async function markUndoReverted(ids: string[]): Promise<void> {
  const data = await load();
  const set = new Set(ids);
  data.undoLog.forEach((e) => {
    if (set.has(e.id)) e.reverted = true;
  });
  await save();
}
