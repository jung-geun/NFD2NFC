import { updateCrc32 } from './crc32';
import type { CollectedFile } from './collectFiles';
import { deferred } from './deferred';
import { assertSizeLimit } from './resourcePolicy';

export interface BuildProgress {
  /** 완료된 파일 수. */
  done: number;
  /** 전체 파일 수. */
  total: number;
  /** ZIP 헤더를 제외하고 실제로 처리한 원본 파일 바이트 수. */
  bytesDone: number;
  /** 원본 파일의 총 바이트 수. */
  bytesTotal: number;
  currentPath?: string;
}

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const CRC_CHUNK_BYTES = 256 * 1024;

/**
 * Write a UTF-8 STORE archive without retaining payload chunks in JavaScript.
 * Each File is read once for CRC, then the native Blob references that original
 * File between its local header and the next entry. There are no data descriptors.
 * Only names/headers/central records consume JS memory proportional to file count.
 *
 * ZIP32 is used below its reserved sentinel values; sizes/offsets >= 0xffffffff
 * and counts >= 0xffff use ZIP64 extras/end records. DOS timestamps preserve local
 * mtime to two-second precision, clamped to the representable 1980–2107 range.
 * The web resource policy caps payload and final ZIP bytes before Blob creation.
 */
export async function buildZip(
  files: CollectedFile[],
  onProgress?: (p: BuildProgress) => void,
): Promise<Blob> {
  const total = files.length;
  let bytesTotal = 0;
  let lastYield = performance.now();
  const cooperate = async () => {
    if (performance.now() - lastYield >= 8) {
      await yieldToBrowser();
      lastYield = performance.now();
    }
  };
  for (const { file, zipPath } of files) {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error(`Cannot ZIP "${zipPath}": invalid or inexact File.size (${file.size}).`);
    }
    bytesTotal = addLength(bytesTotal, file.size);
    assertSizeLimit(bytesTotal, '처리할 파일 합계');
    await cooperate();
  }

  let done = 0;
  let bytesDone = 0;
  let currentPath: string | undefined;
  let lastProgress = performance.now();
  const report = () => {
    onProgress?.({ done, total, bytesDone, bytesTotal, currentPath });
    lastProgress = performance.now();
  };
  report();
  await yieldToBrowser();
  lastYield = performance.now();

  const parts: BlobPart[] = [];
  const directory: BlobPart[] = [];
  const encoder = new TextEncoder();
  let offset = 0;
  let directorySize = 0;
  for (const { file, zipPath } of files) {
    currentPath = zipPath;
    const name = encodeName(encoder, zipPath);
    const crc = await fileCrc32(file, zipPath, async (size) => {
      bytesDone += size;
      if (performance.now() - lastProgress >= 50) report();
      await cooperate();
    });
    const size64 = file.size >= UINT32_MAX;
    const offset64 = offset >= UINT32_MAX;
    const version = size64 || offset64 ? 45 : 20;
    const { date, time } = dosTimestamp(file.lastModified);

    const local = new ArrayBuffer(30 + name.length + (size64 ? 20 : 0));
    const localView = new DataView(local);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, version, true);
    localView.setUint16(6, 0x0800, true); // UTF-8; STORE (method 0), no descriptor.
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, size64 ? UINT32_MAX : file.size, true);
    localView.setUint32(22, size64 ? UINT32_MAX : file.size, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, size64 ? 20 : 0, true);
    new Uint8Array(local, 30, name.length).set(name);
    if (size64) {
      const extra = 30 + name.length;
      localView.setUint16(extra, 0x0001, true);
      localView.setUint16(extra + 2, 16, true);
      setUint64(localView, extra + 4, file.size); // Uncompressed, then compressed.
      setUint64(localView, extra + 12, file.size);
    }

    const extraSize = (size64 ? 16 : 0) + (offset64 ? 8 : 0);
    const central = new ArrayBuffer(46 + name.length + (extraSize ? 4 + extraSize : 0));
    const centralView = new DataView(central);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, version, true); // Made by DOS; no Unix mode attributes.
    centralView.setUint16(6, version, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, size64 ? UINT32_MAX : file.size, true);
    centralView.setUint32(24, size64 ? UINT32_MAX : file.size, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint16(30, extraSize ? 4 + extraSize : 0, true);
    centralView.setUint32(42, offset64 ? UINT32_MAX : offset, true);
    new Uint8Array(central, 46, name.length).set(name);
    if (extraSize) {
      let extra = 46 + name.length;
      centralView.setUint16(extra, 0x0001, true);
      centralView.setUint16(extra + 2, extraSize, true);
      extra += 4;
      if (size64) {
        setUint64(centralView, extra, file.size);
        setUint64(centralView, extra + 8, file.size);
        extra += 16;
      }
      if (offset64) setUint64(centralView, extra, offset);
    }

    const nextOffset = addLength(addLength(offset, local.byteLength), file.size);
    const nextDirectorySize = addLength(directorySize, central.byteLength);
    assertSizeLimit(nextOffset + nextDirectorySize + (total >= UINT16_MAX ? 98 : 22), '생성 ZIP');
    parts.push(local, file);
    directory.push(central);
    offset = nextOffset;
    directorySize = nextDirectorySize;
    done++;
    if (performance.now() - lastProgress >= 50) report();
    await cooperate();
  }

  const directoryOffset = offset;
  for (const record of directory) {
    parts.push(record);
    await cooperate();
  }
  offset = addLength(offset, directorySize);
  if (total >= UINT16_MAX || directorySize >= UINT32_MAX || directoryOffset >= UINT32_MAX) {
    const end64 = new ArrayBuffer(56);
    const view = new DataView(end64);
    view.setUint32(0, 0x06064b50, true);
    setUint64(view, 4, 44); // Remaining length of this ZIP64 end record.
    view.setUint16(12, 45, true);
    view.setUint16(14, 45, true);
    setUint64(view, 24, total);
    setUint64(view, 32, total);
    setUint64(view, 40, directorySize);
    setUint64(view, 48, directoryOffset);
    const locator = new ArrayBuffer(20);
    const locatorView = new DataView(locator);
    locatorView.setUint32(0, 0x07064b50, true);
    setUint64(locatorView, 8, offset);
    locatorView.setUint32(16, 1, true); // Single disk.
    parts.push(end64, locator);
    offset = addLength(offset, end64.byteLength + locator.byteLength);
  }
  const end = new ArrayBuffer(22);
  const endView = new DataView(end);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, Math.min(total, UINT16_MAX), true);
  endView.setUint16(10, Math.min(total, UINT16_MAX), true);
  endView.setUint32(12, Math.min(directorySize, UINT32_MAX), true);
  endView.setUint32(16, Math.min(directoryOffset, UINT32_MAX), true);
  parts.push(end);
  const archiveSize = addLength(offset, end.byteLength);
  assertSizeLimit(archiveSize, '생성 ZIP');

  let result: Blob;
  try {
    result = new Blob(parts, { type: 'application/zip' });
  } catch (error) {
    throw new Error(`The browser could not create the ZIP Blob: ${String(error)}`);
  }
  if (result.size !== archiveSize) {
    throw new Error(`The browser created an incomplete ZIP Blob: expected ${archiveSize} bytes, got ${result.size}.`);
  }
  report();
  return result;
}

/** Blob.size and the public byte counters must remain exact JavaScript integers. */
function addLength(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new Error('ZIP byte length exceeds the exact integer range of the browser Blob API.');
  }
  return sum;
}

function setUint64(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value % 0x100000000, true);
  view.setUint32(offset + 4, Math.floor(value / 0x100000000), true);
}

function encodeName(encoder: TextEncoder, path: string): Uint8Array {
  if (!path || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || /[\u0000\\]/.test(path)) {
    throw new Error(`Invalid ZIP name ${JSON.stringify(path)}: expected a relative POSIX path without NUL.`);
  }
  // TextEncoder replaces lone surrogates; reject rather than silently change a name.
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = path.charCodeAt(++index);
      if (low >= 0xdc00 && low <= 0xdfff) continue;
    } else if (code < 0xdc00 || code > 0xdfff) {
      continue;
    }
    throw new Error(`Invalid ZIP name ${JSON.stringify(path)}: unpaired UTF-16 surrogate.`);
  }
  const name = encoder.encode(path);
  if (name.length > UINT16_MAX) {
    throw new Error(`ZIP name is ${name.length} UTF-8 bytes; the format allows at most ${UINT16_MAX}: ${path}`);
  }
  return name;
}

function dosTimestamp(mtime: number): { date: number; time: number } {
  const date = new Date(mtime);
  const year = date.getFullYear();
  if (!Number.isFinite(year) || year < 1980) return { date: 33, time: 0 };
  if (year > 2107) return { date: (127 << 9) | (12 << 5) | 31, time: (23 << 11) | (59 << 5) | 29 };
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

function yieldToBrowser(): Promise<void> {
  const { promise, resolve } = deferred<void>();
  setTimeout(resolve, 0); // Also progresses in background tabs (unlike rAF).
  return promise;
}

async function fileCrc32(
  file: File,
  path: string,
  onBytes: (size: number) => Promise<void>,
): Promise<number> {
  let crc = -1;
  let bytes = 0;
  const consume = async (chunk: Uint8Array) => {
    if (chunk.byteLength > file.size - bytes) {
      throw new Error(`Cannot ZIP "${path}": File stream exceeds its declared ${file.size} bytes.`);
    }
    for (let offset = 0; offset < chunk.length; offset += CRC_CHUNK_BYTES) {
      const part = chunk.subarray(offset, offset + CRC_CHUNK_BYTES);
      crc = updateCrc32(crc, part);
      bytes += part.length;
      await onBytes(part.length);
    }
  };

  try {
    if (typeof file.stream === 'function') {
      const reader = file.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await consume(value);
        }
      } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
      } finally {
        reader.releaseLock();
      }
    } else {
      // Never arrayBuffer() the whole file: older browsers also get bounded reads.
      for (let offset = 0; offset < file.size; offset += CRC_CHUNK_BYTES) {
        await consume(new Uint8Array(await file.slice(offset, offset + CRC_CHUNK_BYTES).arrayBuffer()));
      }
    }
  } catch (error) {
    throw new Error(`Unable to read "${path}" for ZIP CRC: ${String(error)}`);
  }
  if (bytes !== file.size) {
    throw new Error(`Cannot ZIP "${path}": expected ${file.size} bytes but read ${bytes}.`);
  }
  return (~crc) >>> 0;
}
