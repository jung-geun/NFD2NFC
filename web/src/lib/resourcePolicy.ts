export const MAX_PROCESSING_BYTES = 100 * 1024 * 1024;
export const PROCESSING_LIMIT_LABEL = '100 MiB';
export const RESULT_LIFETIME_MS = 5 * 60 * 1000;

export function assertSizeLimit(bytes: number, subject: string): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_PROCESSING_BYTES) {
    throw new Error(`${subject} 용량은 최대 ${PROCESSING_LIMIT_LABEL}입니다. 파일을 나누어 선택하거나 CLI·데스크톱 앱을 이용해 주세요.`);
  }
}
