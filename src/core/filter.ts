// 한글 NFD 자모 코드포인트 범위 (macOS가 한글 파일명을 NFD로 저장할 때 분해되는 범위)
const HANGUL_RANGES: ReadonlyArray<[number, number]> = [
  [0x1100, 0x11ff], // Hangul Jamo (초성·중성·종성)
  [0xa960, 0xa97f], // Hangul Jamo Extended-A
  [0xd7b0, 0xd7ff], // Hangul Jamo Extended-B
];

export interface FilterOptions {
  customRanges?: Array<[number, number]>;
}

/**
 * 파일명을 NFC로 변환할 필요가 있는지 확인한다.
 * 조건: 이미 NFC가 아니면서, 한글 자모 코드포인트(또는 사용자 화이트리스트 범위)가 포함된 경우.
 * 라틴 악센트(U+0300 등)만 있는 파일명은 한글 범위에 해당하지 않으므로 false를 반환한다.
 */
export function shouldNormalize(name: string, opts?: FilterOptions): boolean {
  if (name === name.normalize('NFC')) return false;

  const ranges = [...HANGUL_RANGES, ...(opts?.customRanges ?? [])];

  for (const ch of name) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (ranges.some(([lo, hi]) => cp >= lo && cp <= hi)) return true;
  }

  return false;
}
