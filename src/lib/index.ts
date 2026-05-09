// 1.0.0 호환 shim — 단순 문자열 정규화
export const normalizeToNFC = (s: string): string => s.normalize('NFC');
export const normalizeToNFD = (s: string): string => s.normalize('NFD');

// 파일 시스템 API
export { normalizeEntry } from '../core/normalizer';
export { scan } from '../core/scanner';
export { shouldNormalize } from '../core/filter';
export type { FilterOptions } from '../core/filter';
export type { ScanEntry } from '../core/scanner';
export type { RenameResult } from '../core/types';
