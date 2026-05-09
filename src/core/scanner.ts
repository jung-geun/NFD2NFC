import fs, { Dirent } from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { shouldNormalize } from './filter';
import type { FilterOptions } from './filter';

export interface ScanEntry {
  path: string;
  type: 'file' | 'directory';
}

/**
 * 디렉토리를 재귀적으로 스캔해 NFD→NFC 변환이 필요한 항목을 반환한다.
 * 깊이 역순으로 정렬해 자식부터 rename할 수 있게 한다 (부모 경로 무효화 방지).
 */
export async function scan(
  dirPath: string,
  recursive: boolean,
  opts?: FilterOptions
): Promise<ScanEntry[]> {
  const entries: ScanEntry[] = [];
  await walk(dirPath, recursive, entries, opts);
  // 경로 깊이 역순: 하위 항목이 먼저 오도록
  entries.sort((a, b) => b.path.split(path.sep).length - a.path.split(path.sep).length);
  return entries;
}

async function walk(
  dir: string,
  recursive: boolean,
  entries: ScanEntry[],
  opts?: FilterOptions
): Promise<void> {
  let dirents: Dirent[];
  try {
    dirents = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const dirent of dirents) {
    const fullPath = path.join(dir, dirent.name);
    if (shouldNormalize(dirent.name, opts)) {
      entries.push({ path: fullPath, type: dirent.isDirectory() ? 'directory' : 'file' });
    }
    if (recursive && dirent.isDirectory()) {
      await walk(fullPath, recursive, entries, opts);
    }
  }
}
