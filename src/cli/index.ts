#!/usr/bin/env node
import fs from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { scan } from '../core/scanner';
import { normalizeEntry } from '../core/normalizer';
import type { RenameResult } from '../core/types';

void yargs(hideBin(process.argv))
  .usage('Usage: $0 <command|path> [options]')
  .command(
    'file <path>',
    '단일 파일의 이름을 NFD→NFC로 변환',
    (y) => y.positional('path', { describe: '변환할 파일 경로', type: 'string', demandOption: true }),
    (args) => runFile(args.path as string)
  )
  .command(
    'dir <path>',
    '디렉토리 내 파일명을 NFD→NFC로 변환',
    (y) =>
      y
        .positional('path', { describe: '변환할 디렉토리 경로', type: 'string', demandOption: true })
        .option('recursive', { alias: 'r', describe: '하위 디렉토리 포함', type: 'boolean', default: false })
        .option('dry-run', { alias: 'n', describe: '실제 변환 없이 대상 파일만 출력', type: 'boolean', default: false }),
    (args) => runDir(args.path as string, args.recursive, args['dry-run'])
  )
  .command(
    '$0 [path]',
    '파일 또는 디렉토리를 자동 감지하여 NFD→NFC로 변환',
    (y) =>
      y
        .positional('path', { describe: '변환할 경로', type: 'string' })
        .option('recursive', { alias: 'r', describe: '하위 디렉토리 포함 (디렉토리인 경우)', type: 'boolean', default: false })
        .option('dry-run', { alias: 'n', describe: '실제 변환 없이 대상만 출력', type: 'boolean', default: false }),
    async (args) => {
      if (!args.path) {
        console.error('경로를 지정해주세요. nfd2nfc --help 로 도움말을 확인하세요.');
        process.exit(1);
      }
      try {
        const stat = await fs.stat(args.path);
        if (stat.isDirectory()) {
          await runDir(args.path, args.recursive, args['dry-run']);
        } else {
          await runFile(args.path);
        }
      } catch (err) {
        console.error(`오류: ${(err as Error).message}`);
        process.exit(1);
      }
    }
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .parseAsync();

async function runFile(filePath: string): Promise<void> {
  try {
    console.log(`파일 변환: ${filePath}`);
    const result = await normalizeEntry(filePath, 'file');
    printResult(result);
  } catch (err) {
    console.error(`오류: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function runDir(dirPath: string, recursive: boolean, dryRun: boolean): Promise<void> {
  try {
    const entries = await scan(dirPath, recursive);
    if (entries.length === 0) {
      console.log('변환 대상 없음.');
      return;
    }

    if (dryRun) {
      console.log(`[미리보기] 변환 대상 ${entries.length}개:`);
      for (const e of entries) {
        const nfc = e.path.split('/').pop()!.normalize('NFC');
        console.log(`  ${e.type === 'directory' ? '📁' : '📄'} ${e.path} → .../${nfc}`);
      }
      return;
    }

    console.log(`디렉토리 변환 시작: ${dirPath}${recursive ? ' (재귀)' : ''}`);
    const results: RenameResult[] = [];
    for (const e of entries) {
      const result = await normalizeEntry(e.path, e.type);
      results.push(result);
    }
    printResults(results);
  } catch (err) {
    console.error(`오류: ${(err as Error).message}`);
    process.exit(1);
  }
}

function printResult(r: RenameResult): void {
  const label = r.type === 'directory' ? '폴더' : '파일';
  if (r.status === 'renamed') {
    console.log(`✓ ${label}: ${r.oldPath} → ${r.newPath}`);
  } else if (r.status === 'skipped') {
    console.log(`- ${label}: 변환 불필요 (${r.oldPath})`);
  } else if (r.status === 'noop-same-inode') {
    console.log(`= ${label}: APFS 동일 inode — 이미 접근 가능 (${r.newPath})`);
  } else {
    console.warn(`⚠ ${label}: 충돌 — 대상 파일이 이미 존재합니다 (${r.newPath})`);
  }
}

function printResults(results: RenameResult[]): void {
  let renamed = 0;
  for (const r of results) {
    printResult(r);
    if (r.status === 'renamed') renamed++;
  }
  console.log(`\n완료: ${renamed}개 변환됨 (총 ${results.length}개 처리)`);
}
