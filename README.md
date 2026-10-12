# NFD to NFC Normalizer

macOS에서 한글 파일명이 NFD(자모 분해)로 저장되는 문제를 실시간으로 해결하는 트레이 앱 + CLI + Node.js 라이브러리 통합 패키지입니다.

> **웹 버전**: 설치 없이 [웹 변환기](https://jung-geun.github.io/NFD2NFC/)에서 ZIP·파일·폴더를 선택하거나 끌어다 놓으면 한글 파일명을 정리한 ZIP을 받을 수 있습니다. 파일은 서버로 전송되지 않습니다.

> **Breaking Change (2.0.0)**: 단일 패키지 구조로 통합됐습니다. `MACOS-APP/`, `nfd2nfc/` 서브 패키지 구조는 제거됐습니다. CLI 명령이 `nfd2nfc file <path>` / `nfd2nfc dir <path>` 형태로 변경됐습니다.

## 주요 기능

- **실시간 감시**: 선택한 디렉토리를 chokidar로 감시하여 파일이 생기는 즉시 NFC로 자동 변환
- **트레이 팝오버**: macOS 메뉴바에 상주, 좌클릭으로 300×400 팝오버 표시
- **설정창**: 3탭 설정 화면 (감시 디렉토리 / Undo 기록 / 일반)
- **Auto / Manual 모드**: Auto는 즉시 변환, Manual은 큐에 누적 후 직접 적용
- **Undo 시스템**: 마지막 5초 배치 또는 개별 변환 되돌리기
- **알림 배치**: 30초 간격으로 변환 건수를 묶어 알림 — 알림 폭주 방지
- **APFS 정확 처리**: 같은 inode 비교로 normalization-insensitive 파일 시스템 올바르게 처리
- **한글 자모 필터**: U+1100-11FF, U+A960-A97F, U+D7B0-D7FF 영역만 대상 (라틴 NFD는 무시)

## 설치

### macOS 애플리케이션

[릴리즈 페이지](https://github.com/jung-geun/NFD2NFC/releases)에서 `NFD2NFC-arm64.dmg` 또는 `NFD2NFC-x64.dmg`를 다운로드하거나 직접 빌드합니다.

### CLI (글로벌 설치)

```bash
npm install -g @pieroot/nfd2nfc
```

### Node.js 라이브러리

```bash
npm install @pieroot/nfd2nfc
```

## 사용법

### 웹 변환기

1. **ZIP·파일 선택** 또는 **폴더 선택**을 누르거나 파일·폴더를 드롭합니다. 폴더 선택을 지원하지 않는 브라우저에서도 일반 파일 선택은 사용할 수 있습니다.
2. **파일 읽기 / ZIP 해제 → 이름 분석 → ZIP 압축 → 링크 생성**이 실제 처리 상태와 함께 표시됩니다. 진행률은 해당 단계의 파일·ZIP 개수 또는 실제 읽은 바이트를 기준으로 합니다. 모션을 보여주기 위한 인위적인 대기 시간은 없습니다.
3. 완료 후 **ZIP 다운로드**를 누릅니다. 결과는 생성 시점부터 **5분**만 유지하며, 시간이 지나면 임시 파일 참조와 다운로드 URL을 자동 해제합니다. 다시 시작하거나 페이지를 떠나도 해제됩니다. 원본 파일은 변경하지 않습니다.

- 파일 선택은 **서버 업로드가 아닙니다**. File API로 기기 안에서 읽고 ZIP을 만들며, `localStorage`·`sessionStorage`·IndexedDB·OPFS·Cache API에 사용자 파일을 저장하지 않습니다. 배포용 빌드에는 `connect-src 'none'`·`form-action 'none'` CSP를 적용해 네트워크 전송과 폼 제출을 차단합니다. 개발 서버의 HMR 연결에는 이 정책을 적용하지 않습니다.
- 선택한 파일의 합계, ZIP 해제 후 파일의 합계, 생성 ZIP의 크기를 **각각 100MiB(104,857,600바이트)**로 제한합니다. 여러 ZIP과 일반 파일을 함께 선택해도 합산하며, ZIP 해제 크기는 본문을 풀기 전에 검사합니다. ZIP 헤더도 출력 크기에 포함되므로 입력이 정확히 100MiB이면 결과는 제한을 넘을 수 있습니다. 더 큰 자료는 CLI·데스크톱 앱을 이용해주세요.
- 백그라운드 탭에서 타이머가 중지되더라도 탭 복귀·포커스·페이지 복원·다운로드 클릭 시 실제 만료 시각을 다시 검사합니다. 다시 시작할 때는 Safari 다운로드 시작을 위해 URL 해제를 최대 1초 늦추며, 지연 해제 중인 URL도 페이지를 떠나면 즉시 해제합니다. 브라우저의 실제 메모리 회수 시점은 브라우저가 결정하며, **사용자가 다운로드한 파일은 자동 삭제할 수 없습니다**.
- [GitHub Pages 공식 제한](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)은 게시 사이트 1GB, 월 전송량 100GB(soft limit)입니다. 변환 파일은 GitHub에 저장하거나 전송하지 않으므로 이 용량에 포함되지 않습니다. [브라우저 Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#web_storage)의 origin당 `localStorage` 약 5MiB 제한은 서버 용량과 별개이며, 이 변환기는 파일 보관에 사용하지 않습니다.

- 선택한 ZIP과 폴더 안의 ZIP은 한 단계만 해제합니다. 내부 상대 경로를 원래 ZIP의 상위 폴더 아래에 유지하며, ZIP 안에 들어 있는 또 다른 ZIP은 파일 그대로 보관합니다. 빈 디렉토리는 결과에 포함하지 않습니다.
- 한글 NFD가 있는 경로만 NFC로 바꿉니다. 이름이 겹치면 `-2`, `-3` 등의 번호를 붙여 파일 내용을 덮어쓰지 않습니다. 이미 NFC인 이름과 한글 이외의 이름은 정규화하지 않습니다.
- ZIP 파일명은 UTF-8 플래그와 유효한 Unicode Path 메타데이터를 우선합니다. 인코딩 표시가 없는 이름은 UTF-8, 한국어 Windows CP949 순서로 읽습니다. 다른 구형 인코딩은 UTF-8 ZIP으로 다시 저장한 뒤 선택해주세요.
- ZIP 입력은 STORE·DEFLATE 및 ZIP64를 지원하며, ZIP64 정보 없이 정확히 65,535개 항목을 담은 일반 ZIP도 읽습니다. Windows식 경로 구분자를 처리하며, 경로 이탈·CRC 불일치·손상된 ZIP은 오류로 알립니다. 암호화·분할 ZIP·심볼릭 링크·다른 압축 방식은 지원하지 않습니다.
- 출력은 내용 재압축 없이 **STORE** 방식으로 묶고, 65,535개 이상의 항목에는 ZIP64를 사용합니다. 파일을 스트리밍으로 읽어 CRC를 계산하고 원본 Blob을 참조하므로 전체 출력 바이트를 JavaScript 배열에 쌓지 않습니다. DEFLATE 버퍼도 검사한 항목 크기로 제한하고 크기 불일치를 거부합니다. 100MiB 제한 안에서도 실제 처리 가능 여부는 기기의 메모리와 브라우저에 따라 달라집니다.
- 모바일·태블릿 레이아웃, 키보드 선택, 라이트·다크 테마, 시스템의 모션 감소 설정을 지원합니다. 완료·오류 상태는 텍스트로도 전달됩니다.

### macOS 애플리케이션

앱 실행 후 메뉴바 아이콘을 좌클릭하면 팝오버가 표시됩니다. 감시 중인 디렉토리 목록과 최근 활동, Undo 버튼을 한눈에 확인할 수 있습니다.

![트레이 팝오버](./assets/manubar.png)

메뉴바 아이콘을 우클릭하면 감시 일시 정지, 설정창 열기, 종료 메뉴가 나옵니다.

![메뉴바 컨텍스트 메뉴](./assets/menubar-setting.png)

설정창의 **디렉토리** 탭에서 감시할 디렉토리를 추가하고, 디렉토리별로 감시 활성화 여부 / Auto·Manual 모드 / 하위 폴더 포함 / 추가 필터 범위를 개별 설정할 수 있습니다. 추가된 디렉토리는 앱 재시작 시에도 유지됩니다.

![디렉토리 설정](./assets/setting-directory.png)

**일반** 탭에서는 기본 변환 모드, macOS 알림 활성화, 알림 인터벌(초)을 설정합니다.

![일반 설정](./assets/setting-general.png)

### CLI

```bash
# 디렉토리 변환 (재귀)
nfd2nfc dir <path> --recursive

# 미리보기 (실제 변환 없음)
nfd2nfc dir <path> --dry-run

# 단일 파일 변환
nfd2nfc file <path>

# 경로 자동 감지 (파일/디렉토리 판별 후 처리)
nfd2nfc <path>

# 도움말
nfd2nfc --help
```

### Node.js 라이브러리

```javascript
const nfd2nfc = require("@pieroot/nfd2nfc");

// v1 호환 — 단순 문자열 정규화
const nfc = nfd2nfc.normalizeToNFC("NFD로 인코딩된 문자열");
const nfd = nfd2nfc.normalizeToNFD("NFC로 인코딩된 문자열");

// v2 신규 — 파일 시스템 API
const { normalizeEntry, scan, shouldNormalize } = require("@pieroot/nfd2nfc");

// 단일 파일/디렉토리 rename (APFS inode 처리 포함)
const result = await normalizeEntry("/path/to/file", "file");
// result.status: 'renamed' | 'skipped' | 'noop-same-inode' | 'collision'

// 디렉토리 재귀 스캔 (깊이 역순 정렬)
const entries = await scan("/path/to/dir", true);
```

## 빌드

```bash
npm install

# 개발 모드
npm run dev

# 전체 빌드 (앱 + CLI + 라이브러리 + DMG)
npm run build

# 앱만 빌드
npm run build:app

# CLI만 빌드
npm run build:cli

# 웹 개발 / 배포용 정적 빌드
npm run web:dev
npm run web:build

# 웹 타입 검사 / 전체 회귀 테스트
npx tsc --noEmit --project web/tsconfig.json
npm test
```

## 기여

이 프로젝트에 기여하려면 다음 단계를 따르세요:

1. 이 저장소를 포크합니다.
2. 새로운 브랜치를 만듭니다: `git checkout -b feat/new-feature`
3. 변경 사항을 커밋합니다: `git commit -am 'Add new feature'`
4. 브랜치에 푸시합니다: `git push origin feat/new-feature`
5. PR을 만듭니다.

## 라이선스

이 프로젝트는 MIT 라이선스를 사용합니다.
