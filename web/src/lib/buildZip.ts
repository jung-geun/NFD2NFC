import { Zip, ZipPassThrough } from 'fflate';
import type { CollectedFile } from './collectFiles';

export interface BuildProgress {
  /** 완료된 파일 수. */
  done: number;
  /** 전체 파일 수. */
  total: number;
}

/**
 * NFC 경로로 정규화된 파일 목록을 스트리밍 방식으로 ZIP 으로 묶는다.
 *
 * - fflate 의 Zip + ZipPassThrough 사용. ZipPassThrough 는 deflate 없이 STORE 모드로 묶기 때문에
 *   사진/영상처럼 이미 압축된 파일이 많은 일반 케이스에서 CPU 를 낭비하지 않는다.
 * - 파일명은 JS 문자열로 그대로 넘긴다. fflate 는 non-ASCII 가 포함되면 general purpose bit 11
 *   (UTF-8 flag)을 자동으로 켜기 때문에 Windows Explorer 가 CP949 로 오디코딩하지 않는다.
 * - 한 번에 하나씩 파이프해서 다중 entry 가 동시에 push 되지 않도록 한다 (Zip 은 순차 처리 필요).
 */
export async function buildZip(
  files: CollectedFile[],
  onProgress?: (p: BuildProgress) => void,
): Promise<Blob> {
  const chunks: Uint8Array[] = [];

  const zipDone = new Promise<void>((resolve, reject) => {
    const zip = new Zip((err, data, final) => {
      if (err) {
        reject(err);
        return;
      }
      if (data && data.length) chunks.push(data);
      if (final) resolve();
    });

    void (async () => {
      try {
        let done = 0;
        for (const f of files) {
          const entry = new ZipPassThrough(f.zipPath);
          zip.add(entry);
          await pipeFileToEntry(f.file, entry);
          done++;
          onProgress?.({ done, total: files.length });
        }
        zip.end();
      } catch (e) {
        reject(e);
      }
    })();
  });

  await zipDone;
  // Uint8Array<ArrayBufferLike> 의 TypeScript 5.7+ 변경 때문에 BlobPart 직접 매칭이 실패할 수 있어 캐스팅.
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}

async function pipeFileToEntry(file: File, entry: ZipPassThrough): Promise<void> {
  // 일부 브라우저(특히 구버전) 에서 Blob.stream() 이 없을 수 있어 fallback 으로 arrayBuffer 사용.
  if (typeof file.stream !== 'function') {
    const buf = new Uint8Array(await file.arrayBuffer());
    entry.push(buf, true);
    return;
  }

  const reader = file.stream().getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        entry.push(new Uint8Array(0), true);
        return;
      }
      if (value && value.length) entry.push(value, false);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 다운로드 트리거. URL.revokeObjectURL 로 메모리 해제까지 처리.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 같은 microtask 에서 revoke 하면 일부 브라우저에서 다운로드가 취소될 수 있어 약간 지연.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
