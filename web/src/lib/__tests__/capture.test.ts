import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { captureDroppedInputs, captureFileInputs, collectFromFileList } from '../collectFiles';
import { buildZip } from '../buildZip';

function protectedDrop(roots: { file: File | null; entry: FileSystemEntry | null }[], files: File[]) {
  let protectedStore = false;
  const access = <T>(value: T): T => {
    if (protectedStore) throw new Error('The native drop event has ended');
    return value;
  };
  const items = roots.map(({ file, entry }) => ({
    kind: 'file',
    getAsFile: () => access(file),
    webkitGetAsEntry: () => access(entry),
  }));
  return {
    transfer: {
      get items() { return access(items); },
      get files() { return access(files); },
    } as unknown as DataTransfer,
    protect() { protectedStore = true; },
  };
}

function fileEntry(file: File): FileSystemEntry {
  return {
    name: file.name,
    isFile: true,
    isDirectory: false,
    file: (success: (file: File) => void) => success(file),
  } as FileSystemFileEntry;
}

function directoryEntry(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader() {
      let page = 0;
      return {
        readEntries: (success: (entries: FileSystemEntry[]) => void) => success(batches[page++] ?? []),
      };
    },
  } as FileSystemDirectoryEntry;
}

const nfd = (name: string) => name.normalize('NFD');

describe('deferred native input capture', () => {
  it.each(['items', 'files'] as const)('collects separate real file and ZIP payloads after %s drop access is protected', async (source) => {
    const ordinary = new File(['ordinary bytes'], nfd('한글.txt'));
    const zipped = new File([
      zipSync({ [nfd('하위/한글.txt')]: strToU8('archive bytes') }, { level: 6 }) as BlobPart,
    ], 'archive.zip');
    const files = [ordinary, zipped];
    const drop = protectedDrop(source === 'items' ? files.map((file) => ({ file, entry: null })) : [], files);
    const inputs = captureDroppedInputs(drop.transfer);
    drop.protect();

    expect(inputs.map(({ name }) => name)).toEqual([ordinary.name, 'archive.zip']);
    const first = await inputs[0].collect();
    const second = await inputs[1].collect();
    expect(first.files.map(({ zipPath }) => zipPath)).toEqual(['한글.txt']);
    expect(second.files.map(({ zipPath }) => zipPath)).toEqual(['하위/한글.txt']);
    expect(first.archiveCount).toBe(0);
    expect(second.archiveCount).toBe(1);
    expect(second.extractedCount).toBe(1);

    for (const [index, result] of [first, second].entries()) {
      const output = await buildZip(result.files);
      const roundTrip = await collectFromFileList([new File([output], 'download.zip')]);
      expect(roundTrip.files.map(({ zipPath }) => zipPath)).toEqual(result.files.map(({ zipPath }) => zipPath));
      expect(await roundTrip.files[0].file.text()).toBe(index === 0 ? 'ordinary bytes' : 'archive bytes');
    }
  });

  it('defers paginated directory traversal and groups its descendants independently of a sibling entry-only file', async () => {
    const nested = directoryEntry(nfd('하위'), [[
      fileEntry(new File(['nested bytes'], nfd('한글.txt'))),
      fileEntry(new File([], 'empty.txt')),
    ]]);
    const root = directoryEntry(nfd('폴더'), [
      [nested],
      [fileEntry(new File(['root bytes'], nfd('끝.txt')))],
    ]);
    let traversed = false;
    const createReader = (root as FileSystemDirectoryEntry).createReader.bind(root);
    (root as FileSystemDirectoryEntry).createReader = () => {
      traversed = true;
      return createReader();
    };
    const sibling = new File(['sibling bytes'], nfd('한글.txt'));
    const drop = protectedDrop([
      { entry: root, file: null },
      { entry: fileEntry(sibling), file: null },
    ], [sibling]);
    const inputs = captureDroppedInputs(drop.transfer);
    drop.protect();

    expect(traversed).toBe(false);
    expect(inputs.map(({ name }) => name)).toEqual([nfd('폴더'), sibling.name]);
    const folder = await inputs[0].collect();
    const loose = await inputs[1].collect();
    expect(folder.files.map(({ zipPath }) => zipPath)).toEqual([
      '폴더/하위/한글.txt', '폴더/하위/empty.txt', '폴더/끝.txt',
    ]);
    expect(await Promise.all(folder.files.map(({ file }) => file.text()))).toEqual(['nested bytes', '', 'root bytes']);
    expect(loose.files.map(({ zipPath }) => zipPath)).toEqual(['한글.txt']);
    expect(await loose.files[0].file.text()).toBe('sibling bytes');
  });

  it('keeps a picked folder grouped with its internal archive and paths after the picker is reset', async () => {
    const ordinary = new File(['ordinary bytes'], nfd('한글.txt'));
    const zipped = new File([
      zipSync({ [nfd('한글.txt')]: strToU8('archive bytes') }, { level: 6 }) as BlobPart,
    ], 'archive.zip');
    Object.defineProperty(ordinary, 'webkitRelativePath', { value: nfd('폴더/한글.txt') });
    Object.defineProperty(zipped, 'webkitRelativePath', { value: `${nfd('폴더/하위')}/archive.zip` });
    const liveFiles = [ordinary, zipped];
    const inputs = captureFileInputs(liveFiles as unknown as FileList, true);
    liveFiles.length = 0;

    expect(inputs.map(({ name }) => name)).toEqual([nfd('폴더')]);
    const result = await inputs[0].collect();
    expect(result.files.map(({ zipPath }) => zipPath)).toEqual(['폴더/한글.txt', '폴더/하위/한글.txt']);
    expect(await Promise.all(result.files.map(({ file }) => file.text()))).toEqual(['ordinary bytes', 'archive bytes']);
    expect(result.archiveCount).toBe(1);
    expect(result.extractedCount).toBe(1);
  });
});
