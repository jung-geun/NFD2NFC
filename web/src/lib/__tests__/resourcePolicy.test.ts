import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { captureDroppedInputs, captureFileInputs, collectFromFileList } from '../collectFiles';
import { buildZip } from '../buildZip';
import { updateCrc32 } from '../crc32';
import { MAX_PROCESSING_BYTES } from '../resourcePolicy';

function collectFolder(...files: File[]) {
  for (const file of files) {
    Object.defineProperty(file, 'webkitRelativePath', { value: `folder/${file.name}` });
  }
  return captureFileInputs(files as unknown as FileList, true)[0].collect();
}

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
  it('rejects an additional byte across files in one folder conversion', async () => {
    const boundary = sizedFile('boundary.bin', MAX_PROCESSING_BYTES);
    await expect(collectFolder(boundary, new File(['x'], 'extra.txt')))
      .rejects.toThrow(/선택한 파일 합계.*최대/);
  });

  it('gives each picked or dropped top-level file its own selected-byte budget', async () => {
    const files = [
      sizedFile('boundary.bin', MAX_PROCESSING_BYTES),
      new File(['x'], 'extra.txt'),
      sizedFile('oversized.bin', MAX_PROCESSING_BYTES + 1),
    ];
    const transfer = {
      files,
      items: files.map((file) => ({ kind: 'file', getAsFile: () => file })),
    } as unknown as DataTransfer;
    for (const inputs of [captureFileInputs(files as unknown as FileList, false), captureDroppedInputs(transfer)]) {
      expect(inputs).toHaveLength(3);
      const first = await inputs[0].collect();
      const second = await inputs[1].collect();
      expect(first.files.map(({ file }) => file)).toEqual([files[0]]);
      expect(second.files.map(({ file }) => file)).toEqual([files[1]]);
      await expect(inputs[2].collect()).rejects.toThrow(/선택한 파일 합계.*최대/);
    }
  });

  it('enforces the aggregate output cap within one ZIP conversion', async () => {
    const files = [sizedFile('first.bin', MAX_PROCESSING_BYTES / 2), sizedFile('second.bin', MAX_PROCESSING_BYTES / 2 + 1)];
    await expect(buildZip(files.map((file) => ({ file, zipPath: file.name, originalPath: file.name, normalized: false }))))
      .rejects.toThrow(/처리할 파일 합계.*최대/);
  });

  it('rejects an oversized declared archive member before inflation', async () => {
    await expect(collectFromFileList([declaredArchive(MAX_PROCESSING_BYTES + 1)]))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('reserves ordinary files even when they follow an archive in a folder conversion', async () => {
    // Keep selected bytes below the input cap while the declared extracted bytes exceed it.
    await expect(collectFolder(declaredArchive(4096), sizedFile('ordinary.bin', MAX_PROCESSING_BYTES - 2048)))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('shares the extracted-byte budget across ZIPs in one folder conversion', async () => {
    const first = new File([zipSync({ 'first.txt': strToU8('first') }, { level: 6 }) as BlobPart], 'first.zip');
    await expect(collectFolder(first, declaredArchive(MAX_PROCESSING_BYTES - 4)))
      .rejects.toThrow(/압축 해제 후 파일 합계.*최대/);
  });

  it('rejects understated DEFLATE size even if the declared CRC matches the truncated prefix', async () => {
    const prefixCrc = (~updateCrc32(-1, strToU8('p'))) >>> 0;
    await expect(collectFromFileList([declaredArchive(1, prefixCrc)]))
      .rejects.toThrow(/크기가 올바르지 않습니다/);
  });

  it('still extracts valid DEFLATE contents and zero-byte entries', async () => {
    const archive = new File([zipSync({ '한글.txt': strToU8('bounded-content'), 'empty.txt': new Uint8Array() }, { level: 6 }) as BlobPart], 'valid.zip');
    const result = await collectFromFileList([archive]);
    expect(await Promise.all(result.files.map((file) => file.file.text()))).toEqual(['bounded-content', '']);
  });
});
