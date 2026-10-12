import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { collectFromDataTransfer, collectFromFileList } from '../collectFiles';
import { buildZip } from '../buildZip';
import { updateCrc32 } from '../crc32';
import { MAX_PROCESSING_BYTES } from '../resourcePolicy';

const list = (...files: File[]) => files as unknown as FileList;

// File handles expose size before contents are read; avoid allocating large test payloads.
function sizedFile(name: string, size: number): File {
  const file = new File([], name);
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function declaredArchive(size: number, checksum?: number): File {
  const bytes = zipSync({ 'payload.txt': strToU8('payload'.repeat(1024)) }, { level: 6 });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const central = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint32(22, size, true);
  view.setUint32(central + 24, size, true);
  if (checksum !== undefined) {
    view.setUint32(14, checksum, true);
    view.setUint32(central + 16, checksum, true);
  }
  return new File([bytes as BlobPart], 'declared.zip');
}

describe('browser resource limits', () => {
  it('rejects an additional byte across otherwise individually allowed files', async () => {
    const boundary = sizedFile('boundary.bin', MAX_PROCESSING_BYTES);
    await expect(collectFromFileList(list(boundary, new File(['x'], 'extra.txt'))))
      .rejects.toThrow(/선택한 파일 합계.*최대/);
  });

  it('enforces the same aggregate cap for dropped files and ZIP writing', async () => {
    const files = [sizedFile('first.bin', MAX_PROCESSING_BYTES / 2), sizedFile('second.bin', MAX_PROCESSING_BYTES / 2 + 1)];
    const transfer = {
      files,
      items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    } as unknown as DataTransfer;
    await expect(collectFromDataTransfer(transfer)).rejects.toThrow(/선택한 파일 합계.*최대/);
    await expect(buildZip(files.map((file) => ({ file, zipPath: file.name, originalPath: file.name, normalized: false }))))
      .rejects.toThrow(/처리할 파일 합계.*최대/);
  });

  it('rejects an oversized declared archive member before inflation', async () => {
    await expect(collectFromFileList(list(declaredArchive(MAX_PROCESSING_BYTES + 1))))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('reserves ordinary files even when they follow an archive', async () => {
    // Keep selected bytes below the input cap while the declared extracted bytes exceed it.
    await expect(collectFromFileList(list(declaredArchive(4096), sizedFile('ordinary.bin', MAX_PROCESSING_BYTES - 2048))))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('shares the extracted-byte budget across multiple ZIPs', async () => {
    const first = new File([zipSync({ 'first.txt': strToU8('first') }, { level: 6 }) as BlobPart], 'first.zip');
    await expect(collectFromFileList(list(first, declaredArchive(MAX_PROCESSING_BYTES - 4))))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('rejects understated DEFLATE size even if the declared CRC matches the truncated prefix', async () => {
    const prefixCrc = (~updateCrc32(-1, strToU8('p'))) >>> 0;
    await expect(collectFromFileList(list(declaredArchive(1, prefixCrc))))
      .rejects.toThrow(/크기가 올바르지 않습니다/);
  });

  it('still extracts valid DEFLATE contents and zero-byte entries', async () => {
    const archive = new File([zipSync({ '한글.txt': strToU8('bounded-content'), 'empty.txt': new Uint8Array() }, { level: 6 }) as BlobPart], 'valid.zip');
    const result = await collectFromFileList(list(archive));
    expect(await Promise.all(result.files.map((file) => file.file.text()))).toEqual(['bounded-content', '']);
  });
});
