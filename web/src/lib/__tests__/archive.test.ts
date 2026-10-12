import { describe, expect, it } from 'vitest';
import { collectFromFileList } from '../collectFiles';
import { buildZip } from '../buildZip';
import { updateCrc32 } from '../crc32';

const encode = (text: string) => new TextEncoder().encode(text);

// STORE fixture with independently authored local/central records. Allows duplicate raw names,
// legacy encoding and ZIP64 records, none of which a filename-keyed fixture object can represent.
function archive(entries: { name: Uint8Array; text: string; flags?: number; corrupt?: boolean; zip64?: boolean; localExtra?: Uint8Array }[]): File {
  const parts: BlobPart[] = [];
  const directory: BlobPart[] = [];
  let offset = 0;
  let directorySize = 0;
  for (const entry of entries) {
    const content = encode(entry.text);
    const crc = (~updateCrc32(-1, content)) >>> 0;
    const local = new ArrayBuffer(30 + entry.name.length + (entry.zip64 ? 20 : entry.localExtra?.length ?? 0));
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, entry.zip64 ? 45 : 20, true);
    lv.setUint16(6, entry.flags ?? 0x800, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, entry.zip64 ? 0xffffffff : content.length, true);
    lv.setUint32(22, entry.zip64 ? 0xffffffff : content.length, true);
    lv.setUint16(26, entry.name.length, true);
    lv.setUint16(28, entry.zip64 ? 20 : entry.localExtra?.length ?? 0, true);
    new Uint8Array(local, 30, entry.name.length).set(entry.name);
    if (entry.localExtra) new Uint8Array(local, 30 + entry.name.length).set(entry.localExtra);
    if (entry.zip64) {
      const extra = 30 + entry.name.length;
      lv.setUint16(extra, 1, true);
      lv.setUint16(extra + 2, 16, true);
      lv.setBigUint64(extra + 4, BigInt(content.length), true);
      lv.setBigUint64(extra + 12, BigInt(content.length), true);
    }
    const central = new ArrayBuffer(46 + entry.name.length + (entry.zip64 ? 28 : 0));
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, entry.zip64 ? 45 : 20, true);
    cv.setUint16(6, entry.zip64 ? 45 : 20, true);
    cv.setUint16(8, entry.flags ?? 0x800, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.zip64 ? 0xffffffff : content.length, true);
    cv.setUint32(24, entry.zip64 ? 0xffffffff : content.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, entry.zip64 ? 28 : 0, true);
    cv.setUint32(42, entry.zip64 ? 0xffffffff : offset, true);
    new Uint8Array(central, 46, entry.name.length).set(entry.name);
    if (entry.zip64) {
      const extra = 46 + entry.name.length;
      cv.setUint16(extra, 1, true);
      cv.setUint16(extra + 2, 24, true);
      cv.setBigUint64(extra + 4, BigInt(content.length), true);
      cv.setBigUint64(extra + 12, BigInt(content.length), true);
      cv.setBigUint64(extra + 20, BigInt(offset), true);
    }
    if (entry.corrupt) content[0] ^= 0xff;
    parts.push(local, content);
    directory.push(central);
    directorySize += central.byteLength;
    offset += local.byteLength + content.length;
  }
  parts.push(...directory);
  const usesZip64 = entries.some((entry) => entry.zip64);
  if (usesZip64) {
    const end64 = new ArrayBuffer(56);
    const view = new DataView(end64);
    view.setUint32(0, 0x06064b50, true);
    view.setBigUint64(4, 44n, true);
    view.setUint16(12, 45, true);
    view.setUint16(14, 45, true);
    view.setBigUint64(24, BigInt(entries.length), true);
    view.setBigUint64(32, BigInt(entries.length), true);
    view.setBigUint64(40, BigInt(directorySize), true);
    view.setBigUint64(48, BigInt(offset), true);
    const locator = new ArrayBuffer(20);
    const loc = new DataView(locator);
    loc.setUint32(0, 0x07064b50, true);
    loc.setBigUint64(8, BigInt(offset + directorySize), true);
    loc.setUint32(16, 1, true);
    parts.push(end64, locator);
  }
  const end = new ArrayBuffer(22);
  const ev = new DataView(end);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, usesZip64 ? 0xffff : entries.length, true);
  ev.setUint16(10, usesZip64 ? 0xffff : entries.length, true);
  ev.setUint32(12, usesZip64 ? 0xffffffff : directorySize, true);
  ev.setUint32(16, usesZip64 ? 0xffffffff : offset, true);
  parts.push(end);
  return new File(parts, 'fixture.zip', { type: 'application/zip' });
}

const collect = (file: File) => collectFromFileList([file] as unknown as FileList);

describe('browser archive compatibility', () => {
  it('preserves contents while canonicalizing Windows separators and Korean legacy names', async () => {
    // CP949 bytes for 자료\\한글.txt, as in the user's legacy Korean ZIPs.
    const cp949 = Uint8Array.from([0xc0, 0xda, 0xb7, 0xe1, 0x5c, 0xc7, 0xd1, 0xb1, 0xdb, 0x2e, 0x74, 0x78, 0x74]);
    const result = await collect(archive([
      { name: encode('13\\panels\\'), text: '' },
      { name: encode('13\\panels\\manifest.txt'), text: 'manifest', localExtra: encode('2271\0') },
      { name: cp949, flags: 0, text: 'legacy-content' },
    ]));
    expect(result.files.map((file) => file.zipPath)).toEqual(['13/panels/manifest.txt', '자료/한글.txt']);
    expect(await Promise.all(result.files.map((file) => file.file.text()))).toEqual(['manifest', 'legacy-content']);
  });

  it('keeps duplicate raw entries after NFC collisions instead of overwriting data', async () => {
    const nfd = encode('한글.txt'.normalize('NFD'));
    const result = await collect(archive([
      { name: nfd, text: 'first' },
      { name: nfd, text: 'second' },
      { name: encode('한글.txt'), text: 'third' },
    ]));
    expect(result.files.map((file) => file.zipPath)).toEqual(['한글.txt', '한글-2.txt', '한글-3.txt']);
    expect(await Promise.all(result.files.map((file) => file.file.text()))).toEqual(['first', 'second', 'third']);
  });

  it.each(['../outside.txt', '..\\outside.txt', '/absolute.txt', 'C:\\absolute.txt'])('rejects unsafe paths: %s', async (path) => {
    await expect(collect(archive([{ name: encode(path), text: 'unsafe' }]))).rejects.toThrow(/경로/);
  });

  it('rejects corrupt STORE content rather than generating a successful download', async () => {
    await expect(collect(archive([{ name: encode('file.txt'), text: 'original', corrupt: true }]))).rejects.toThrow(/CRC/);
  });

  it('reads ZIP64 size/offset extras and end records', async () => {
    const result = await collect(archive([{ name: encode('한글.txt'), text: 'zip64-content', zip64: true }]));
    expect(result.files.map((file) => file.zipPath)).toEqual(['한글.txt']);
    expect(await result.files[0].file.text()).toBe('zip64-content');
  });

  it('accepts the classic 65,535-entry boundary without a ZIP64 locator', async () => {
    const fixture = archive(Array.from({ length: 65535 }, (_, index) => ({
      name: encode(`item-${index}.txt`), text: '',
    })));
    // Model a real contiguous input file, not 131,070 separate Blob header parts.
    const result = await collect(new File([await fixture.arrayBuffer()], fixture.name));
    expect(result.files).toHaveLength(65535);
    expect(result.files[0].zipPath).toBe('item-0.txt');
    expect(result.files.at(-1)?.zipPath).toBe('item-65534.txt');
    expect(result.extractedCount).toBe(65535);
  }, 30_000);

  it('round-trips a STORE archive without stream() and preserves zero-byte entries', async () => {
    const payload = new File(['real-bytes'], '한글.txt');
    Object.defineProperty(payload, 'stream', { value: undefined });
    const result = await collectFromFileList([payload, new File([], 'zero.txt')] as unknown as FileList);
    const output = await buildZip(result.files);
    const unpacked = await collect(new File([output], 'output.zip'));
    expect(unpacked.files.map((file) => file.zipPath)).toEqual(['한글.txt', 'zero.txt']);
    expect(await Promise.all(unpacked.files.map((file) => file.file.text()))).toEqual(['real-bytes', '']);
  });
});
