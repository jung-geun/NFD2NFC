import { normalizeToNFC, shouldNormalize } from './normalize';

export interface CollectedFile {
  /** ZIP 내부에서 사용할 NFC 정규화된 상대 경로 (POSIX, 디렉토리 segment 포함). */
  zipPath: string;
  /** 원본 상대 경로 (디버그/통계용). */
  originalPath: string;
  /** 실제 파일 핸들. */
  file: File;
  /** 경로 segment 중 하나 이상이 정규화되었는지. */
  normalized: boolean;
}

export interface CollectResult {
  files: CollectedFile[];
  normalizedCount: number;
  passthroughCount: number;
  collisions: string[];
}

/**
 * webkitGetAsEntry 가 동작하는지 확인. Safari < 16.4 등에서 folder drop 시 null 반환.
 */
export function supportsDirectoryDrop(items: DataTransferItemList): boolean {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    if (typeof item.webkitGetAsEntry !== 'function') return false;
  }
  return true;
}

/**
 * DataTransfer 에서 파일과 폴더를 모두 수집한다.
 * - 폴더는 webkitGetAsEntry 로 재귀 traversal.
 * - DirectoryReader.readEntries 는 Chromium 에서 호출당 최대 100 개만 반환 → 빈 배열 나올 때까지 루프.
 * - 각 path segment 를 독립적으로 NFC 정규화.
 * - 정규화 후 경로 충돌 시 -2, -3 ... suffix 로 회피.
 */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<CollectResult> {
  const items = dt.items;
  const entries: FileSystemEntry[] = [];
  // file objects collected when item.webkitGetAsEntry() returns null (드물게 발생).
  const looseFiles: File[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'file') continue;
    const entry =
      typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      entries.push(entry);
    } else {
      const f = item.getAsFile();
      if (f) looseFiles.push(f);
    }
  }

  const flat: { path: string; file: File }[] = [];

  for (const e of entries) {
    await walkEntry(e, '', flat);
  }
  for (const f of looseFiles) {
    flat.push({ path: f.name, file: f });
  }

  return finalize(flat);
}

/**
 * `<input type="file" webkitdirectory>` 또는 일반 input 에서 수집.
 */
export function collectFromFileList(files: FileList): CollectResult {
  const flat: { path: string; file: File }[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // webkitRelativePath 가 비어있으면 단일 파일 선택.
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    flat.push({ path: rel, file: f });
  }
  return finalize(flat);
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { path: string; file: File }[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ path: prefix + entry.name, file });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 페이지네이션: 빈 배열 반환할 때까지 반복.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      for (const child of batch) {
        await walkEntry(child, prefix + entry.name + '/', out);
      }
    }
  }
}

function finalize(flat: { path: string; file: File }[]): CollectResult {
  const seen = new Set<string>();
  const collisions: string[] = [];
  const collected: CollectedFile[] = [];
  let normalizedCount = 0;
  let passthroughCount = 0;

  for (const { path, file } of flat) {
    const segments = path.split('/');
    let normalized = false;
    const nfcSegments = segments.map((seg) => {
      if (shouldNormalize(seg)) {
        normalized = true;
        return normalizeToNFC(seg);
      }
      return seg;
    });
    if (normalized) normalizedCount++;
    else passthroughCount++;

    let nfcPath = nfcSegments.join('/');
    if (seen.has(nfcPath)) {
      collisions.push(nfcPath);
      nfcPath = disambiguate(nfcPath, seen);
    }
    seen.add(nfcPath);

    collected.push({
      zipPath: nfcPath,
      originalPath: path,
      file,
      normalized,
    });
  }

  return {
    files: collected,
    normalizedCount,
    passthroughCount,
    collisions,
  };
}

function disambiguate(path: string, seen: Set<string>): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  const hasExt = dot > slash; // 디렉토리 안의 dot 만 확장자로 인식
  const stem = hasExt ? path.slice(0, dot) : path;
  const ext = hasExt ? path.slice(dot) : '';
  let n = 2;
  while (seen.has(`${stem}-${n}${ext}`)) n++;
  return `${stem}-${n}${ext}`;
}
