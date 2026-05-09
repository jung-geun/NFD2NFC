import fs from 'fs/promises';
import path from 'path';
import { shouldNormalize } from './filter';
import type { FilterOptions } from './filter';
import type { RenameResult } from './types';

export async function normalizeEntry(
  entryPath: string,
  type: 'file' | 'directory',
  opts?: FilterOptions
): Promise<RenameResult> {
  const dir = path.dirname(entryPath);
  const basename = path.basename(entryPath);

  if (!shouldNormalize(basename, opts)) {
    return { type, oldPath: entryPath, newPath: entryPath, status: 'skipped' };
  }

  const nfcBasename = basename.normalize('NFC');
  const newPath = path.join(dir, nfcBasename);

  return doRename(entryPath, newPath, type);
}

async function doRename(
  oldPath: string,
  newPath: string,
  type: 'file' | 'directory'
): Promise<RenameResult> {
  let targetExists = false;
  try {
    await fs.access(newPath);
    targetExists = true;
  } catch {
    // 대상 없음 → 안전하게 rename 가능
  }

  if (targetExists) {
    // APFS는 normalization-insensitive: NFD와 NFC 경로가 같은 inode일 수 있음
    const [srcStat, dstStat] = await Promise.all([fs.stat(oldPath), fs.stat(newPath)]);
    if (srcStat.ino !== dstStat.ino) {
      // 다른 inode → 진짜 충돌, 스킵
      return { type, oldPath, newPath, status: 'collision' };
    }
    // 같은 inode: APFS가 두 경로를 동일 파일로 처리하는 것.
    // 그러나 디렉토리 엔트리는 여전히 NFD로 저장되어 있으므로 rename으로 NFC 엔트리로 업데이트.
  }

  await fs.rename(oldPath, newPath);
  return { type, oldPath, newPath, status: 'renamed' };
}
