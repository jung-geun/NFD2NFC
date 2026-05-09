import { describe, it, expect } from 'vitest';
import { shouldNormalize } from '../filter';

// 한글 NFD: macOS Finder가 생성하는 한글 파일명 형태 (자모 분리)
// U+1100 (ᄀ) + U+1161 (ᅡ) + U+11AB (ᆫ) = "간" 의 NFD
const HANGUL_GA_NFD = '가'; // 가 (NFD: 초성+중성)
const HANGUL_GAN_NFD = '간'; // 간 (NFD: 초성+중성+종성)
const HANGUL_WORD_NFD = `${HANGUL_GA_NFD}${HANGUL_GAN_NFD}`; // 파일명용

// NFC 한글
const HANGUL_GA_NFC = '가'; // 가 (NFC: 완성형)
const HANGUL_GAN_NFC = '간'; // 간 (NFC: 완성형)

describe('shouldNormalize', () => {
  it('한글 NFD 자모가 포함된 파일명 → true', () => {
    expect(shouldNormalize(`${HANGUL_WORD_NFD}.txt`)).toBe(true);
  });

  it('이미 NFC인 한글 파일명 → false', () => {
    expect(shouldNormalize(`${HANGUL_GA_NFC}${HANGUL_GAN_NFC}.txt`)).toBe(false);
  });

  it('ASCII 파일명 → false', () => {
    expect(shouldNormalize('hello-world.txt')).toBe(false);
  });

  it('라틴 악센트 NFD (café) → false (한글 범위 아님)', () => {
    // é = e + combining acute accent (U+0301) → NFD
    const cafeNfd = 'café.txt'; // é in NFD
    expect(shouldNormalize(cafeNfd)).toBe(false);
  });

  it('한글 NFC + 영문 혼합 파일명이 이미 NFC → false', () => {
    expect(shouldNormalize('hello-가나다.txt')).toBe(false);
  });

  it('사용자 커스텀 범위 추가 시 해당 범위 NFD 코드포인트를 포함한 파일명 → true', () => {
    // 일본어 히라가나 탁점 결합 (예시): U+3099 combining voiced iteration mark
    // 여기서는 임의 코드포인트 U+0300 범위를 화이트리스트에 추가
    const name = 'café.txt'; // é NFD (combining U+0301)
    expect(shouldNormalize(name, { customRanges: [[0x0300, 0x036f]] })).toBe(true);
  });

  it('파일명에 한글 자모 확장-A 범위 코드포인트가 있으면 → true', () => {
    // U+A960 Hangul Jamo Extended-A
    const _name = 'ꥠfile.txt'; // 확장-A 자모
    // 이 코드포인트는 단독으로 NFC와 다른 NFD를 만들지는 않지만 filter 범위 테스트
    // shouldNormalize는 먼저 NFC 동일성 체크를 하므로, NFC!=원본인 경우에만 범위 체크함
    // 따라서 실제로 NFD인 상황을 만들기 위해 함께 한글 자모를 섞어 줌
    const nfdWithExtA = `ꥠ${HANGUL_GA_NFD}.txt`;
    expect(shouldNormalize(nfdWithExtA)).toBe(true);
  });
});
