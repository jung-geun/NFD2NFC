// 브라우저 환경 전용 정규화 헬퍼.
// src/core/filter.ts 는 fs 의존성이 없는 순수 모듈이므로 그대로 import.
// src/lib/index.ts 는 normalizer/scanner(fs 사용)를 re-export 하므로 import 하지 않는다.
export { shouldNormalize } from '@core/core/filter';

export const normalizeToNFC = (s: string): string => s.normalize('NFC');
