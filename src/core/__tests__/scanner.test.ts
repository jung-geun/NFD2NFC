import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { scan } from '../scanner';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfc-scan-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const NFD = '간'; // 간 NFD
const NFC = '간'; // 간 NFC

describe('scan', () => {
  it('NFD 파일을 감지해 반환', async () => {
    await fs.writeFile(path.join(tmpDir, `${NFD}.txt`), '');
    await fs.writeFile(path.join(tmpDir, 'ascii.txt'), '');
    await fs.writeFile(path.join(tmpDir, `${NFC}.txt`), '');

    const entries = await scan(tmpDir, false);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toContain(NFD);
    expect(entries[0].type).toBe('file');
  });

  it('재귀=false: 하위 폴더 안 파일은 포함 안 됨', async () => {
    const sub = path.join(tmpDir, 'subdir');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, `${NFD}.txt`), '');

    const entries = await scan(tmpDir, false);
    expect(entries).toHaveLength(0);
  });

  it('재귀=true: 하위 폴더 안 NFD 파일도 포함', async () => {
    const sub = path.join(tmpDir, 'subdir');
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, `${NFD}.txt`), '');

    const entries = await scan(tmpDir, true);
    expect(entries).toHaveLength(1);
  });

  it('결과가 깊이 역순으로 정렬됨 (자식 먼저)', async () => {
    const sub = path.join(tmpDir, `${NFD}_dir`);
    await fs.mkdir(sub);
    await fs.writeFile(path.join(sub, `${NFD}.txt`), '');

    const entries = await scan(tmpDir, true);
    // 파일(더 깊음)이 폴더(얕음)보다 먼저 나와야 함
    expect(entries[0].type).toBe('file');
    expect(entries[entries.length - 1].type).toBe('directory');
  });
});
