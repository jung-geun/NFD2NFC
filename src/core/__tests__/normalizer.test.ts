import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { normalizeEntry } from '../normalizer';

// 테스트용 임시 디렉토리
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfc-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// 한글 NFD 자모
const NFD_PREFIX = '간'; // 간 (NFD)
const NFC_PREFIX = '간'; // 간 (NFC)

describe('normalizeEntry — file', () => {
  it('NFD 한글 파일명을 NFC로 rename', async () => {
    const nfdName = `${NFD_PREFIX}.txt`;
    const nfcName = `${NFC_PREFIX}.txt`;
    const filePath = path.join(tmpDir, nfdName);
    await fs.writeFile(filePath, 'test');

    const result = await normalizeEntry(filePath, 'file');
    expect(result.status).toBe('renamed');
    expect(result.newPath).toBe(path.join(tmpDir, nfcName));

    // 새 경로에 파일 존재
    const exists = await fs.stat(result.newPath).then(() => true).catch(() => false);
    expect(exists).toBe(true);
  });

  it('이미 NFC인 파일명 → skipped', async () => {
    const nfcName = `${NFC_PREFIX}.txt`;
    const filePath = path.join(tmpDir, nfcName);
    await fs.writeFile(filePath, 'test');

    const result = await normalizeEntry(filePath, 'file');
    expect(result.status).toBe('skipped');
  });

  it('라틴 악센트 NFD → skipped (한글 필터)', async () => {
    // e + combining acute accent (é in NFD)
    const nfdName = 'caféNFD.txt'; // 이미 NFC라 아래에서 직접 NFD로 만들기
    // 실제 NFD 문자열: NFC e('e') + combining acute U+0301
    const nfdReal = 'café.txt';
    const filePath = path.join(tmpDir, nfdReal);
    await fs.writeFile(filePath, 'test');

    const result = await normalizeEntry(filePath, 'file');
    expect(result.status).toBe('skipped');
  });
});

describe('normalizeEntry — directory', () => {
  it('NFD 한글 폴더명을 NFC로 rename', async () => {
    const nfdName = `${NFD_PREFIX}_dir`;
    const nfcName = `${NFC_PREFIX}_dir`;
    const dirPath = path.join(tmpDir, nfdName);
    await fs.mkdir(dirPath);

    const result = await normalizeEntry(dirPath, 'directory');
    expect(result.status).toBe('renamed');
    expect(result.newPath).toBe(path.join(tmpDir, nfcName));
  });
});
