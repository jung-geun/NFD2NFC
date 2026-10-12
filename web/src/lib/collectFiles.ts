import { inflate } from 'fflate';
import { normalizeToNFC, shouldNormalize } from './normalize';
import { deferred } from './deferred';
import { updateCrc32 } from './crc32';
import { assertSizeLimit } from './resourcePolicy';

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
  archiveCount: number;
  extractedCount: number;
}

/** UI metadata must not keep File/Blob payloads alive after the download URL is released. */
export type CollectSummary = Omit<CollectResult, 'files'> & {
  files: Pick<CollectedFile, 'zipPath' | 'originalPath' | 'normalized'>[];
};

export interface CollectProgress {
  phase: 'reading' | 'extracting' | 'analyzing';
  done: number;
  total?: number;
  currentPath?: string;
  archiveCount: number;
}

type SourceFile = { path: string; file: File };
type ProgressCallback = (progress: CollectProgress) => void;
const BATCH_SIZE = 64;

// A task boundary lets React commit and the browser paint, even without an active animation frame.
function yieldToBrowser(): Promise<void> {
  const { promise, resolve } = deferred<void>();
  setTimeout(resolve, 0);
  return promise;
}

function isArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || /^(application\/zip|application\/x-zip-compressed)$/i.test(file.type);
}

/**
 * DataTransfer 에서 파일과 폴더를 모두 수집한다.
 * - 폴더는 webkitGetAsEntry 로 재귀 traversal.
 * - DirectoryReader.readEntries 는 Chromium 에서 호출당 최대 100 개만 반환 → 빈 배열 나올 때까지 루프.
 * - 각 path segment 를 독립적으로 NFC 정규화.
 * - 정규화 후 경로 충돌 시 -2, -3 ... suffix 로 회피.
 */
export async function collectFromDataTransfer(
  dt: DataTransfer,
  onProgress?: ProgressCallback,
): Promise<CollectResult> {
  // The drag data store is protected after the drop handler returns. Capture BOTH APIs before yielding.
  const roots: { entry: FileSystemEntry | null; file: File | null }[] = [];
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    const file = item.getAsFile();
    if (entry || file) roots.push({ entry, file });
  }
  const fallbackFiles = Array.from(dt.files);
  if (roots.length === 0) {
    for (const file of fallbackFiles) roots.push({ entry: null, file });
  }

  const total = roots.some(({ entry }) => entry?.isDirectory) ? undefined : roots.length;
  const flat: SourceFile[] = [];
  let archiveCount = 0;
  let selectedBytes = 0;
  const report = (currentPath?: string) => onProgress?.({
    phase: 'reading', done: flat.length, total, currentPath, archiveCount,
  });
  const add = async (source: SourceFile) => {
    selectedBytes += source.file.size;
    assertSizeLimit(selectedBytes, '선택한 파일 합계');
    flat.push(source);
    if (isArchive(source.file)) archiveCount++;
    if (flat.length % BATCH_SIZE === 0) {
      report(source.path);
      await yieldToBrowser();
    }
  };
  report();
  await yieldToBrowser();
  for (const { entry, file } of roots) {
    if (entry?.isDirectory || (entry && !file)) {
      await walkEntry(entry, '', add);
    } else if (file) {
      await add({ path: file.webkitRelativePath || entry?.name || file.name, file });
    }
  }
  report(flat.at(-1)?.path);
  return prepareFiles(flat, archiveCount, onProgress);
}

/**
 * `<input type="file" webkitdirectory>` 또는 일반 input 에서 수집.
 */
export async function collectFromFileList(
  files: FileList,
  onProgress?: ProgressCallback,
): Promise<CollectResult> {
  // File inputs can be reset by the caller as soon as this function returns its promise.
  const snapshot = Array.from(files);
  const flat: SourceFile[] = [];
  let archiveCount = 0;
  let selectedBytes = 0;
  onProgress?.({ phase: 'reading', done: 0, total: snapshot.length, archiveCount });
  await yieldToBrowser();
  for (const file of snapshot) {
    selectedBytes += file.size;
    assertSizeLimit(selectedBytes, '선택한 파일 합계');
    const path = file.webkitRelativePath || file.name;
    flat.push({ path, file });
    if (isArchive(file)) archiveCount++;
    if (flat.length % BATCH_SIZE === 0 || flat.length === snapshot.length) {
      onProgress?.({ phase: 'reading', done: flat.length, total: snapshot.length, currentPath: path, archiveCount });
      await yieldToBrowser();
    }
  }
  return prepareFiles(flat, archiveCount, onProgress);
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  add: (source: SourceFile) => Promise<void>,
): Promise<void> {
  if (entry.isFile) {
    const result = deferred<File>();
    (entry as FileSystemFileEntry).file(result.resolve, result.reject);
    const file = await result.promise;
    await add({ path: prefix + entry.name, file });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries 페이지네이션: 빈 배열 반환할 때까지 반복.
    for (;;) {
      const result = deferred<FileSystemEntry[]>();
      reader.readEntries(result.resolve, result.reject);
      const batch = await result.promise;
      if (batch.length === 0) break;
      for (const child of batch) {
        await walkEntry(child, prefix + entry.name + '/', add);
      }
      await yieldToBrowser();
    }
  }
}

async function prepareFiles(
  sources: SourceFile[],
  archiveCount: number,
  onProgress?: ProgressCallback,
): Promise<CollectResult> {
  let flat = sources;
  let extractedCount = 0;
  // Count ordinary files up front, even if they appear after an archive in the selection.
  let expandedBytes = sources.reduce((sum, source) => sum + (isArchive(source.file) ? 0 : source.file.size), 0);
  const reserveExpandedBytes = (size: number) => {
    expandedBytes += size;
    assertSizeLimit(expandedBytes, '압축 해제 후 파일 합계');
  };
  if (archiveCount > 0) {
    flat = [];
    let done = 0;
    onProgress?.({ phase: 'extracting', done, total: archiveCount, archiveCount });
    await yieldToBrowser();
    for (const source of sources) {
      if (!isArchive(source.file)) {
        flat.push(source);
        continue;
      }
      onProgress?.({ phase: 'extracting', done, total: archiveCount, currentPath: source.path, archiveCount });
      const extracted = await extractArchive(source, reserveExpandedBytes);
      extractedCount += extracted.length;
      // Do not recurse: ZIPs inside an archive remain ordinary files.
      for (const file of extracted) flat.push(file);
      done++;
      onProgress?.({ phase: 'extracting', done, total: archiveCount, currentPath: source.path, archiveCount });
      await yieldToBrowser();
    }
  }
  onProgress?.({ phase: 'analyzing', done: 0, total: flat.length, archiveCount });
  await yieldToBrowser();
  return finalize(flat, archiveCount, extractedCount, onProgress);
}

async function finalize(
  flat: SourceFile[],
  archiveCount: number,
  extractedCount: number,
  onProgress?: ProgressCallback,
): Promise<CollectResult> {
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
    if (collected.length % BATCH_SIZE === 0 || collected.length === flat.length) {
      onProgress?.({ phase: 'analyzing', done: collected.length, total: flat.length, currentPath: path, archiveCount });
      await yieldToBrowser();
    }
  }

  return {
    files: collected,
    normalizedCount,
    passthroughCount,
    collisions,
    archiveCount,
    extractedCount,
  };
}

interface ArchiveEntry {
  path: string;
  start: number;
  compressedSize: number;
  size: number;
  compression: number;
  checksum: number;
  directory: boolean;
}

function corruptArchive(): never {
  throw new Error('ZIP 구조가 손상되었거나 파일이 끝까지 저장되지 않았습니다.');
}

function multipartArchive(): never {
  throw new Error('여러 파일로 나뉜 분할 ZIP은 지원하지 않습니다. 하나의 ZIP으로 다시 압축해 주세요.');
}

function zip64Integer(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('ZIP64 크기 또는 위치가 JavaScript의 안전한 정수 범위를 벗어납니다.');
  }
  return Number(value);
}

async function readArchiveRange(file: File, start: number, length: number): Promise<Uint8Array> {
  const end = start + length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || !Number.isSafeInteger(end)
    || start < 0 || length < 0 || end > file.size) corruptArchive();
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  if (bytes.length !== length) corruptArchive();
  return bytes;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function readArchiveDirectory(file: File): Promise<{ count: number; start: number; end: number }> {
  // Only the EOCD and its maximum 16-bit comment need to be searched, even for a multi-GiB ZIP.
  const tailStart = Math.max(0, file.size - 22 - 65535);
  const tail = await readArchiveRange(file, tailStart, file.size - tailStart);
  const view = dataView(tail);
  let end = tail.length - 22;
  for (; end >= 0; end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === tail.length) break;
  }
  if (end < 0) corruptArchive();
  const eocd = tailStart + end;
  const disk = view.getUint16(end + 4, true);
  const directoryDisk = view.getUint16(end + 6, true);
  const diskCount = view.getUint16(end + 8, true);
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let start = view.getUint32(end + 16, true);
  let directoryEnd = eocd;
  // Classic ZIP writers may use 0xffff as the exact entry count without ZIP64.
  const needsZip64 = disk === 0xffff || directoryDisk === 0xffff
    || size === 0xffffffff || start === 0xffffffff;
  const locator = eocd >= 20 ? dataView(await readArchiveRange(file, eocd - 20, 20)) : undefined;
  if (locator?.getUint32(0, true) === 0x07064b50) {
    if (locator.getUint32(4, true) !== 0 || locator.getUint32(16, true) !== 1) multipartArchive();
    const zip64Start = zip64Integer(locator, 8);
    if (zip64Start + 56 > eocd - 20) corruptArchive();
    const zip64 = dataView(await readArchiveRange(file, zip64Start, 56));
    if (zip64.getUint32(0, true) !== 0x06064b50) corruptArchive();
    const recordSize = zip64Integer(zip64, 4);
    if (recordSize < 44 || zip64Start + 12 + recordSize !== eocd - 20) corruptArchive();
    if (zip64.getUint32(16, true) !== 0 || zip64.getUint32(20, true) !== 0) multipartArchive();
    const zip64DiskCount = zip64Integer(zip64, 24);
    const zip64Count = zip64Integer(zip64, 32);
    const zip64Size = zip64Integer(zip64, 40);
    const zip64Offset = zip64Integer(zip64, 48);
    if (zip64DiskCount !== zip64Count) multipartArchive();
    if ((disk !== 0 && disk !== 0xffff) || (directoryDisk !== 0 && directoryDisk !== 0xffff)
      || (diskCount !== 0xffff && diskCount !== zip64Count)) multipartArchive();
    if ((count !== 0xffff && count !== zip64Count) || (size !== 0xffffffff && size !== zip64Size)
      || (start !== 0xffffffff && start !== zip64Offset)) corruptArchive();
    count = zip64Count;
    size = zip64Size;
    start = zip64Offset;
    directoryEnd = zip64Start;
  } else {
    if (disk !== 0 || directoryDisk !== 0 || diskCount !== count) multipartArchive();
    if (needsZip64) corruptArchive();
  }
  if (!Number.isSafeInteger(start + size) || start + size !== directoryEnd || count > Math.floor(size / 46)) corruptArchive();
  return { count, start, end: directoryEnd };
}

interface ExtraField {
  tag: number;
  data: Uint8Array;
}

function readExtraFields(bytes: Uint8Array): ExtraField[] {
  const view = dataView(bytes);
  const fields: ExtraField[] = [];
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) corruptArchive();
    const tag = view.getUint16(offset, true);
    const length = view.getUint16(offset + 2, true);
    const end = offset + 4 + length;
    if (end > bytes.length) corruptArchive();
    fields.push({ tag, data: bytes.subarray(offset + 4, end) });
    offset = end;
  }
  return fields;
}

// ZIP64 stores only the fields whose ordinary header values are saturated, in this order.
function resolveZip64(fields: ExtraField[], values: number[]): number[] {
  const extras = fields.filter(({ tag }) => tag === 0x0001);
  if (extras.length > 1) corruptArchive();
  const extra = extras[0]?.data;
  let offset = 0;
  return values.map((value, index) => {
    const disk = index === 3;
    if (value !== (disk ? 0xffff : 0xffffffff)) return value;
    const width = disk ? 4 : 8;
    if (!extra || offset + width > extra.length) corruptArchive();
    const view = dataView(extra);
    const resolved = disk ? view.getUint32(offset, true) : zip64Integer(view, offset);
    offset += width;
    return resolved;
  });
}

function decodeArchivePath(name: Uint8Array, flags: number, fields: ExtraField[]): string {
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  // The UTF-8 flag is authoritative; a legacy fallback must never repair an invalid flagged name.
  if (flags & 0x800) {
    try {
      return utf8.decode(name);
    } catch {
      throw new Error('ZIP 파일명이 올바른 UTF-8이 아닙니다. UTF-8 파일명으로 다시 압축해 주세요.');
    }
  }
  let unicodePath: string | undefined;
  for (const { tag, data } of fields) {
    if (tag !== 0x7075) continue;
    // Unknown versions and stale CRCs are not valid Unicode Path overrides (Info-ZIP spec).
    if (data.length < 5 || data[0] !== 1 || dataView(data).getUint32(1, true) !== ((~updateCrc32(-1, name)) >>> 0)) continue;
    let decoded: string;
    try {
      decoded = utf8.decode(data.subarray(5));
    } catch {
      throw new Error('ZIP의 유니코드 파일명이 올바른 UTF-8이 아닙니다.');
    }
    if (unicodePath !== undefined && unicodePath !== decoded) corruptArchive();
    unicodePath = decoded;
  }
  if (unicodePath !== undefined) return unicodePath;
  try {
    return utf8.decode(name);
  } catch {
    try {
      // WHATWG euc-kr includes the Korean Windows CP949 extension. Never guess Latin-1/CP437.
      return new TextDecoder('euc-kr', { fatal: true }).decode(name);
    } catch {
      throw new Error('ZIP 파일명을 UTF-8 또는 한국어 CP949로 읽을 수 없습니다. UTF-8 파일명으로 다시 압축해 주세요.');
    }
  }
}

function canonicalArchivePath(decoded: string, attributes: number): { path: string; directory: boolean } {
  let path = decoded.replace(/\\/g, '/');
  const directory = path.endsWith('/') || !!(attributes & 0x10) || ((attributes >>> 16) & 0xf000) === 0x4000;
  const unsafe = (): never => { throw new Error(`안전하지 않은 ZIP 내부 경로입니다: ${JSON.stringify(decoded)}`); };
  // Validate after separator canonicalization: this also catches drive paths and Windows UNC paths.
  if (!path || path.startsWith('/') || /[:\u0000-\u001f\u007f-\u009f]/.test(path)) unsafe();
  while (path.startsWith('./')) path = path.slice(2);
  // A harmless explicit root directory (./) carries no file and is ignored.
  if (directory && (path === '' || path === '.')) return { path: '', directory: true };
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (!path || path.split('/').some((segment) => !segment || segment === '.' || segment === '..')) unsafe();
  return { path, directory };
}

// fflate does not validate ZIP checksums, encryption, or local/central header consistency.
// Read metadata and each local header in bounded slices; keep central order and duplicate names.
async function readArchiveEntries(file: File, reserveExpandedBytes: (size: number) => void): Promise<ArchiveEntry[]> {
  const directory = await readArchiveDirectory(file);
  const entries: ArchiveEntry[] = [];
  let cursor = directory.start;
  for (let index = 0; index < directory.count; index++) {
    if (cursor + 46 > directory.end) corruptArchive();
    const view = dataView(await readArchiveRange(file, cursor, 46));
    if (view.getUint32(0, true) !== 0x02014b50) corruptArchive();
    const flags = view.getUint16(8, true);
    const compression = view.getUint16(10, true);
    const checksum = view.getUint32(16, true);
    const nameLength = view.getUint16(28, true);
    const extraLength = view.getUint16(30, true);
    const commentLength = view.getUint16(32, true);
    const attributes = view.getUint32(38, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > directory.end) corruptArchive();
    if (flags & 0x2041) throw new Error('암호화된 ZIP은 열 수 없습니다. 암호를 해제한 ZIP을 선택해 주세요.');
    if (compression !== 0 && compression !== 8) {
      throw new Error(`지원하지 않는 ZIP 압축 방식(${compression})입니다. STORE 또는 DEFLATE 방식으로 다시 압축해 주세요.`);
    }
    const metadata = await readArchiveRange(file, cursor + 46, nameLength + extraLength);
    const name = metadata.subarray(0, nameLength);
    const fields = readExtraFields(metadata.subarray(nameLength));
    const [size, compressedSize, local, disk] = resolveZip64(fields, [
      view.getUint32(24, true), view.getUint32(20, true), view.getUint32(42, true), view.getUint16(34, true),
    ]);
    if (disk !== 0) multipartArchive();
    const { path, directory: isDirectory } = canonicalArchivePath(decodeArchivePath(name, flags, fields), attributes);
    if (((attributes >>> 16) & 0xf000) === 0xa000) {
      throw new Error(`ZIP 내부의 심볼릭 링크는 지원하지 않습니다: ${path}`);
    }
    // Check declared sizes before allocating or inflating any payload from this archive.
    if (!isDirectory) reserveExpandedBytes(size);
    if (local + 30 > directory.start) corruptArchive();
    const header = dataView(await readArchiveRange(file, local, 30));
    if (header.getUint32(0, true) !== 0x04034b50) corruptArchive();
    const localNameLength = header.getUint16(26, true);
    const localExtraLength = header.getUint16(28, true);
    const start = local + 30 + localNameLength + localExtraLength;
    if (!Number.isSafeInteger(start + compressedSize) || start + compressedSize > directory.start
      || localNameLength !== nameLength || header.getUint16(6, true) !== flags || header.getUint16(8, true) !== compression) corruptArchive();
    const localMetadata = await readArchiveRange(file, local + 30, localNameLength + localExtraLength);
    for (let i = 0; i < nameLength; i++) {
      if (localMetadata[i] !== name[i]) corruptArchive();
    }
    const localSizes = [header.getUint32(22, true), header.getUint32(18, true)];
    // ZIP32 sizes are complete already. Some Windows packagers use opaque local extras;
    // only parse them when ZIP64 size sentinels actually require an extra record.
    const [localSize, localCompressedSize] = localSizes.includes(0xffffffff)
      ? resolveZip64(readExtraFields(localMetadata.subarray(localNameLength)), localSizes)
      : localSizes;
    if (!(flags & 8) && (header.getUint32(14, true) !== checksum || localCompressedSize !== compressedSize || localSize !== size)) corruptArchive();
    if (compression === 0 && compressedSize !== size) corruptArchive();
    entries.push({ path, start, compressedSize, size, compression, checksum, directory: isDirectory });
    cursor = next;
    if ((index + 1) % BATCH_SIZE === 0) await yieldToBrowser();
  }
  if (cursor !== directory.end) corruptArchive();
  return entries;
}

async function storedChecksum(blob: Blob): Promise<number> {
  const reader = blob.stream().getReader();
  let checksum = -1;
  let sinceYield = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      checksum = updateCrc32(checksum, value);
      sinceYield += value.length;
      if (sinceYield >= 4 * 1024 * 1024) {
        sinceYield = 0;
        await yieldToBrowser();
      }
    }
  } finally {
    reader.releaseLock();
  }
  return (~checksum) >>> 0;
}

async function extractArchive(source: SourceFile, reserveExpandedBytes: (size: number) => void): Promise<SourceFile[]> {
  try {
    const entries = await readArchiveEntries(source.file, reserveExpandedBytes);
    const parent = source.path.slice(0, source.path.lastIndexOf('/') + 1);
    const files: SourceFile[] = [];
    for (const entry of entries) {
      if (entry.directory) continue;
      const data = source.file.slice(entry.start, entry.start + entry.compressedSize);
      let content: BlobPart = data;
      let checksum: number;
      if (entry.compression === 0) {
        // Preserve file-backed storage; even a >4-GiB STORE entry never needs an archive-sized buffer.
        checksum = await storedChecksum(data);
      } else {
        const compressed = new Uint8Array(await data.arrayBuffer());
        const result = deferred<Uint8Array>();
        // A spare byte detects understated sizes without letting DEFLATE grow an unbounded buffer.
        inflate(compressed, { consume: true, size: entry.size + 1 }, (error, inflated) => {
          if (error) result.reject(error);
          else result.resolve(inflated);
        });
        const inflated = await result.promise;
        if (inflated.length !== entry.size) throw new Error(`압축 해제된 파일 크기가 올바르지 않습니다: ${entry.path}`);
        let value = -1;
        for (let offset = 0; offset < inflated.length; offset += 262144) {
          const end = Math.min(offset + 262144, inflated.length);
          value = updateCrc32(value, inflated.subarray(offset, end));
          if (end < inflated.length) await yieldToBrowser();
        }
        checksum = (~value) >>> 0;
        content = inflated as BlobPart;
      }
      if (checksum !== entry.checksum) throw new Error(`파일 내용이 손상되었습니다(CRC 불일치): ${entry.path}`);
      files.push({
        path: parent + entry.path,
        file: new File([content], entry.path.slice(entry.path.lastIndexOf('/') + 1), { lastModified: source.file.lastModified }),
      });
      if (files.length % BATCH_SIZE === 0) await yieldToBrowser();
    }
    return files;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`ZIP “${source.path}”을(를) 열 수 없습니다. ${detail}`);
  }
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
