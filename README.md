# NFD to NFC Normalizer

macOS의 한글 NFD 파일명을 NFC로 자동 변환하는 **SwiftUI·AppKit 네이티브 앱**입니다. App Store용 Xcode 프로젝트와 독립적인 웹 변환기·CLI·Node.js 라이브러리를 제공합니다.

> **웹 버전**: 설치 없이 [웹 변환기](https://nfd2nfc.com/)에서 ZIP·파일·폴더를 선택하거나 끌어다 놓으면 한글 파일명을 정리한 ZIP을 받을 수 있습니다. 변환 코드는 파일을 서버로 전송하지 않습니다.

> **네이티브 앱 개편 (3.0.0)**: Electron·IPC·chokidar·DMG 배포 경로를 제거했습니다. macOS 13 이상을 지원하며, App Sandbox 때문에 기존 Electron 앱에서 감시하던 폴더는 네이티브 앱에서 다시 선택해 접근 권한을 허용해야 합니다. 기존 CLI·웹·Node.js API는 유지합니다.

## 주요 기능

- **실시간 감시**: 선택한 디렉토리와 모든 하위 폴더를 FSEvents로 감시하고 한글 파일·폴더 이름을 자동 변환합니다. 수동 모드·미리보기·재귀 여부·커스텀 필터 설정은 없습니다.
- **변환 기록**: 최근 최대 1,000건의 파일명·상위 디렉토리·변환 시각을 보여줍니다. Finder에서 위치 보기, 전체 경로 복사, 개별 이름 되돌리기를 제공합니다. 마지막 배치 되돌리기는 제거했습니다.
- **메뉴 막대 ZIP**: 파일·폴더를 팝오버에 드롭하거나 선택하면 **원본은 변경하지 않고 ZIP 내부의 한글 이름만 NFC로 변환**합니다. 결과는 `~/Documents/NFD2NFC`에 저장합니다.
- **일반 설정**: macOS 알림 활성화·알림 간격, Dock·메뉴 막대 아이콘 각각 숨기기, 로그인 시 자동 실행만 제공합니다.
- **안전한 이름 변경**: APFS의 실제 디렉토리 엔트리 바이트를 변경하고 파일 내용은 유지합니다. 같은 이름의 다른 항목을 덮어쓰지 않으며, 되돌리기는 파일 식별 정보를 검사합니다.
- **저전력 구조**: 파일별 폴링 없이 이벤트를 모아 처리합니다. 최초·추가 폴더 스캔과 이벤트 손실 복구 때만 전체 트리를 탐색하고, 기록은 128건씩 전달·최대 1,000건 보관·원자적 묶음 저장합니다.

## 설치

### macOS 애플리케이션

`macOS/NFD2NFC.xcodeproj`를 Xcode에서 열어 실행하거나 아래 네이티브 빌드 명령을 사용합니다. App Store 등록·업로드·심사 승인은 별도 절차이며, 저장소에 실제 스토어 링크나 승인 완료를 가정하지 않습니다.

### CLI (소스에서 글로벌 설치)

Git·Node.js·npm이 필요합니다. GitHub 소스를 받아 CLI를 빌드한 뒤 설치합니다.

```bash
git clone https://github.com/jung-geun/NFD2NFC.git
cd NFD2NFC
npm install
npm run build:cli
npm install -g .
```

설치 후 `nfd2nfc --help`로 명령을 확인할 수 있습니다. CLI는 원본 파일명을 직접 변경하므로 `nfd2nfc dir "./my-folder" --recursive --dry-run`으로 대상을 확인한 뒤 `--dry-run`을 빼고 실행하세요.

### Node.js 라이브러리

위에서 받은 소스 디렉토리에서 라이브러리를 빌드한 뒤, 사용할 Node.js 프로젝트에서 해당 디렉토리를 설치합니다.

```bash
# NFD2NFC 소스 디렉토리에서
npm run build:lib

# 사용할 Node.js 프로젝트에서 (경로를 실제 소스 위치로 바꾸세요)
npm install /absolute/path/to/NFD2NFC
```

## 사용법

### 웹 변환기

1. **ZIP·파일 선택** 또는 **폴더 선택**을 누르거나 파일·폴더를 드롭합니다. 업로드 영역은 처리 중·완료 후에도 유지되어 계속 추가할 수 있습니다. 일반 파일과 ZIP은 각각 별도 변환하고, 폴더는 내부 경로를 유지한 ZIP 하나로 묶습니다. 같은 파일을 다시 선택해도 새 항목으로 추가됩니다. 폴더 선택을 지원하지 않는 브라우저에서도 일반 파일 선택은 사용할 수 있습니다.
2. 추가한 순서대로 **파일 읽기 / ZIP 해제 → 이름 분석 → ZIP 압축 → 링크 생성**을 진행합니다. 처리 중인 항목의 **처리 과정 보기**를 펼치면 진행률을 확인할 수 있습니다. 진행률은 해당 단계의 파일·ZIP 개수 또는 실제 읽은 바이트를 기준으로 하며, 인위적인 대기 시간은 없습니다. 한 항목이 실패해도 앞선 결과는 유지하고 다음 항목을 계속 처리합니다.
3. **출력 파일** 목록에서 완료된 **압축 파일명을 클릭**해 각각 다운로드합니다. 파일명·크기·남은 시간을 한 행에 표시하며 별도 다운로드 카드나 버튼은 없습니다. 결과별로 생성 시점부터 **5분**만 유지하며, `04:59 남음` 형식의 카운트다운을 초 단위로 표시합니다. 새 파일을 추가해도 앞선 결과의 만료 시각은 연장되지 않습니다. 만료 즉시 해당 항목의 임시 파일 참조·다운로드 URL을 해제하며, 행은 먼지처럼 흩어진 뒤 목록에서 자동으로 제거합니다. 행 끝의 **목록에서 삭제(×)**에도 같은 소멸 효과를 적용합니다. 시스템의 동작 줄이기 설정이나 백그라운드 탭에서는 효과 없이 바로 제거합니다. 페이지를 떠나면 모든 결과와 대기 항목을 정리합니다. 원본 파일은 변경하지 않습니다.

- 출력 ZIP은 입력 이름을 기준으로 만듭니다. 일반 파일은 확장자까지 보존해 `보고서.pdf.zip`, ZIP은 마지막 `.zip` 확장자를 중복하지 않아 `자료.zip`, 폴더는 폴더명 뒤에 `.zip`을 붙여 `프로젝트 자료.zip`이 됩니다. 한글 NFD 이름은 NFC로 정리합니다. 같은 이름을 다시 추가해도 각 결과와 다운로드 링크는 독립적이며, 다운로드한 파일의 이름 충돌 처리는 브라우저 설정을 따릅니다.
- 파일 선택은 **서버 업로드가 아닙니다**. 변환 코드는 File API로 기기 안에서 읽고 ZIP을 만들며, `localStorage`·`sessionStorage`·IndexedDB·OPFS·Cache API에 사용자 파일을 저장하지 않습니다. 운영 페이지의 Google AdSense 광고와 Google Analytics 방문·이용 통계 측정은 별도로 외부 통신·쿠키·기기 정보 등을 사용할 수 있고 페이지와 같은 실행 환경을 공유합니다. 따라서 CSP로 모든 네트워크 전송을 차단한다고 보장하지 않습니다. 외부 광고·분석 스크립트 없이 민감한 파일을 처리하려면 로컬 CLI를 이용하세요.
- **각 변환 항목별로** 선택한 파일의 합계, ZIP 해제 후 파일의 합계, 생성 ZIP의 크기를 **각각 100MiB(104,857,600바이트)**로 제한합니다. 서로 다른 최상위 파일·ZIP·폴더는 별도 항목이며, 한 폴더 안의 파일·ZIP은 합산합니다. ZIP 해제 크기는 본문을 풀기 전에 검사합니다. ZIP 헤더도 출력 크기에 포함되므로 입력이 정확히 100MiB이면 결과는 제한을 넘을 수 있습니다. 더 큰 자료는 CLI·데스크톱 앱을 이용해주세요.
- 메모리 부담을 줄이기 위해 변환은 한 번에 하나씩 진행합니다. 백그라운드 탭에서 카운트다운 갱신을 멈추며, 탭 복귀·포커스·페이지 복원·다운로드 클릭 시 항목별 만료 시각을 다시 검사합니다. 수동 삭제의 소멸 효과가 끝난 뒤에는 Safari 다운로드 시작을 위해 URL 해제를 최대 1초 늦추며, 지연 해제 중인 URL도 페이지를 떠나면 즉시 해제합니다. 만료된 URL은 소멸 효과를 기다리지 않고 즉시 해제합니다. 여러 결과의 실제 메모리 사용량과 회수 시점은 기기·브라우저에 따라 달라집니다. **사용자가 다운로드한 파일은 자동 삭제할 수 없습니다**.
- [GitHub Pages 공식 제한](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)은 게시 사이트 1GB, 월 전송량 100GB(soft limit)입니다. 변환 파일은 GitHub에 저장하거나 전송하지 않으므로 이 용량에 포함되지 않습니다. [브라우저 Web Storage](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria#web_storage)의 origin당 `localStorage` 약 5MiB 제한은 서버 용량과 별개이며, 이 변환기는 파일 보관에 사용하지 않습니다.

- 선택한 ZIP과 폴더 안의 ZIP은 한 단계만 해제합니다. 내부 상대 경로를 원래 ZIP의 상위 폴더 아래에 유지하며, ZIP 안에 들어 있는 또 다른 ZIP은 파일 그대로 보관합니다. 빈 디렉토리는 결과에 포함하지 않습니다.
- 한글 NFD가 있는 경로만 NFC로 바꿉니다. 이름이 겹치면 `-2`, `-3` 등의 번호를 붙여 파일 내용을 덮어쓰지 않습니다. 이미 NFC인 이름과 한글 이외의 이름은 정규화하지 않습니다.
- ZIP 파일명은 UTF-8 플래그와 유효한 Unicode Path 메타데이터를 우선합니다. 인코딩 표시가 없는 이름은 UTF-8, 한국어 Windows CP949 순서로 읽습니다. 다른 구형 인코딩은 UTF-8 ZIP으로 다시 저장한 뒤 선택해주세요.
- ZIP 입력은 STORE·DEFLATE 및 ZIP64를 지원하며, ZIP64 정보 없이 정확히 65,535개 항목을 담은 일반 ZIP도 읽습니다. Windows식 경로 구분자를 처리하며, 경로 이탈·CRC 불일치·손상된 ZIP은 오류로 알립니다. 암호화·분할 ZIP·심볼릭 링크·다른 압축 방식은 지원하지 않습니다.
- 출력은 내용 재압축 없이 **STORE** 방식으로 묶고, 65,535개 이상의 항목에는 ZIP64를 사용합니다. 파일을 스트리밍으로 읽어 CRC를 계산하고 원본 Blob을 참조하므로 전체 출력 바이트를 JavaScript 배열에 쌓지 않습니다. DEFLATE 버퍼도 검사한 항목 크기로 제한하고 크기 불일치를 거부합니다. 100MiB 제한 안에서도 실제 처리 가능 여부는 기기의 메모리와 브라우저에 따라 달라집니다.
- 모바일·태블릿 레이아웃, 키보드 선택, 라이트·다크 테마, 시스템의 모션 감소 설정을 지원합니다. 완료·오류 상태는 텍스트로도 전달됩니다.

### macOS 애플리케이션

1. **실시간 감시**에서 **폴더 추가…**를 누르고 실제 감시할 폴더를 선택합니다. 추가 즉시 기존 항목과 이후 생성·이동된 항목을 자동 변환하며, 목록에는 폴더 열기·감시 제거만 제공합니다. 감시 제거는 폴더 삭제가 아닙니다.
2. **변환 기록**에서 현재 파일명과 `…/상위/디렉토리` 형태의 경로를 확인합니다. Finder 보기·전체 경로 복사·개별 이름 되돌리기를 사용할 수 있습니다. 되돌린 항목은 같은 파일 식별자와 같은 이름인 동안 다시 자동 변환하지 않으며, 이 제외 정보도 재시작 후 복원합니다.
3. **일반**에서 알림 간격(초, 기본 30·최소 1), 아이콘 표시, 로그인 시 자동 실행을 설정합니다. 로그인 항목의 체크 상태는 `SMAppService.mainApp.status`에서 읽으며, macOS 승인이 필요한 경우 시스템 설정으로 안내합니다. 앱을 다시 실행하면 저장된 폴더 권한과 감시가 자동으로 복원됩니다.
4. 메뉴 막대 아이콘을 클릭해 파일·폴더를 드롭하거나 **파일 또는 폴더 선택…**을 누릅니다. 팝오버는 Finder에서 드래그를 시작해도 닫히지 않습니다. 아이콘을 다시 클릭하거나 Escape로 닫습니다. ZIP 생성 후 결과와 저장 폴더를 Finder에서 열 수 있습니다.

**폴더 접근 권한:** 앱은 선택한 폴더의 security-scoped bookmark를 로컬 앱 컨테이너에 저장합니다. 권한이 만료되거나 디스크가 분리되면 목록에 오류를 표시합니다. 감시를 제거하지 말고 **폴더 추가…**에서 같은 폴더를 다시 선택해 권한을 갱신하세요. 기존 감시 항목이 유지되어 이전 기록의 되돌리기와 재변환 제외 정보도 유지됩니다. 제거 후 다시 추가하면 새 감시 항목이 되어 이전 기록을 되돌릴 수 없습니다. 샌드박스 접근은 허용된 루트의 파일 디스크립터 안에서만 탐색합니다. 최상위 선택 폴더와 다른 선택 폴더의 상위 경로는 이름을 바꾸지 않습니다. 이름이 `.`으로 시작하는 숨김 항목·심볼릭 링크는 실시간 변환에서 제외하고, 일반 폴더와 앱·문서 패키지는 재귀 탐색합니다.

**ZIP 저장:** 최초 사용 시 실제 사용자 `Documents` 또는 `Documents/NFD2NFC`를 선택해 저장 권한을 허용해야 합니다. 컨테이너의 가상 Documents나 임의의 다른 폴더로 대신 저장하지 않습니다. 결과 이름은 `NFD2NFC.zip`, `NFD2NFC (2).zip`처럼 증가하며 기존 ZIP을 덮어쓰지 않습니다. ZIP 내부 이름 충돌에는 ` (2)` 등의 접미사를 붙이고, 중복·중첩 선택은 정리합니다. 숨김 파일·패키지·빈 디렉토리를 보존하고 원본 내용·원본 이름을 수정하지 않습니다. DEFLATE를 64KiB 버퍼로 스트리밍하고 UTF-8·CRC32·ZIP64·원본 수정 시각·POSIX 모드를 기록합니다. 심볼릭 링크·특수 파일·비 UTF-8 이름·안전하지 않은 상대 경로는 명시적 오류이며, 실패·앱 종료 시 미완성 ZIP을 제거합니다. Finder가 압축 해제한 이름을 다시 NFD로 저장할 수 있지만 **ZIP 안의 한글 이름은 NFC로 유지**됩니다.

**백그라운드 실행:** Dock과 메뉴 막대 아이콘은 독립적으로 숨길 수 있습니다. 둘 다 숨겨도 감시는 계속되며 창을 닫아도 종료하지 않습니다. Finder에서 앱을 다시 열면 기존 실행 인스턴스의 창이 열립니다. 완전히 중단하려면 앱 메뉴 또는 메뉴 막대 팝오버에서 **종료**하세요. 로그인 시 자동 실행은 로그인 때 앱을 실행하는 기능이며, 사용자가 종료한 앱을 강제로 재실행하는 데몬은 아닙니다.

**개인정보:** 네이티브 앱에는 광고·분석 SDK·서버 업로드·네트워크 클라이언트 권한이 없습니다. 선택 경로·변환 기록·접근 권한·설정은 로컬에만 저장합니다. 웹 버전의 광고 동작과는 별개입니다.

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
# 네이티브 앱: Node.js 의존성 불필요
open macOS/NFD2NFC.xcodeproj
make build          # Release 앱, 로컬 실행용 서명
make run
make test           # 네이티브 빌드·파일 시스템·FSEvents·ZIP·앱 설정 회귀 테스트

# App Store 배포용: Apple Developer 서명·프로비저닝 필요
make archive
make export

# CLI·라이브러리·웹은 별도 Node.js 프로젝트
npm install
npm run build:cli
npm run build:lib
npm run typecheck

# 웹 개발 / 배포용 정적 빌드
npm run web:dev
npm run web:build
npm run web:preview

# 웹 타입 검사 / 전체 회귀 테스트
npx tsc --noEmit --project web/tsconfig.json
npm test
```

`make build` 결과는 `.build/xcode/Build/Products/Release/NFD2NFC.app`, `make archive` 결과는 `.build/NFD2NFC.xcarchive`입니다. Release 앱은 Apple Silicon·Intel universal 빌드입니다. Xcode 프로젝트·`macOS/ExportOptions.plist`의 팀은 기존 todo 프로젝트와 같은 `VQXGRP23X5`, 앱 식별자는 `com.pieroot.nfd2nfc`입니다. 다른 계정으로 배포할 때는 두 파일의 팀을 함께 변경하고, App Store Connect에서 같은 앱 식별자의 macOS 앱과 버전 3.0.0을 등록하세요. 유효한 배포 서명·스토어 프로비저닝과 개인정보 처리방침 URL·스토어 메타데이터·스크린샷을 준비한 뒤 Organizer의 **Distribute App → App Store Connect**로 검증·업로드합니다. 업로드·심사는 이 저장소의 빌드 성공과 별개입니다.

App Sandbox·사용자 선택 파일 읽기/쓰기·app-scoped bookmark만 활성화합니다. broad Documents 접근·임시 예외·JIT 권한은 사용하지 않습니다. 개인정보 manifest는 `macOS/NFD2NFC/PrivacyInfo.xcprivacy`에 포함되어 있습니다. GitHub의 기존 Release 워크플로는 네이티브 테스트·빌드 검증으로 전환했으며 DMG 생성·업로드는 하지 않습니다.

### App Store 제출 자료

- [한국어 제출 문안과 체크리스트](docs/app-store/ko-KR.md): 앱 이름·부제·프로모션·설명·100바이트 이내 키워드·영어 심사 메모·App Privacy 권장 답변을 제공합니다. CLI 패키지 버전과 네이티브 앱 버전을 구분합니다.
- [개인정보 처리방침 소스](web/privacy/index.html)와 [지원 페이지 소스](web/support/index.html)는 `https://nfd2nfc.com/privacy/`, `https://nfd2nfc.com/support/`에 대응합니다. 실제 연락 이메일, 로컬 데이터 처리·초기화 방법, 권한 및 ZIP 문제 해결 안내를 포함합니다.
- 앱의 **일반 → 지원 및 개인정보**에서 두 페이지를 외부 기본 브라우저로 열 수 있습니다. 홈페이지 하단과 두 안내 페이지에도 상호 링크가 있습니다.
- 한국어 스크린샷은 `assets/app-store/ko-KR/mac/2880x1800/`의 `01`~`05` 순서로 사용합니다. 묶음 미리보기는 `assets/app-store/preview-ko-KR.jpg`입니다.
- App Store Connect에 URL을 넣기 전에 Pages에 배포하고 외부에서 HTTPS로 본문이 열리는지 확인하세요. 정식 운영자·개인정보 담당자 정보와 문의 정보의 보관·삭제 방식도 실제 운영에 맞게 확인해야 합니다. 저장소의 문안과 로컬 빌드 성공은 배포·업로드·법률 검토·심사 승인을 뜻하지 않습니다.

### 로고 및 에셋

분리된 조각이 하나로 이어지는 N 마크와 코발트 블루를 사용합니다. `macOS/NFD2NFC/Assets.xcassets`에는 macOS `AppIcon`의 16·32·128·256·512pt 각 1x/2x 슬롯 10개(최대 1024×1024), 벡터 `BrandIcon`, 라이트·다크 `BrandMark`, 18pt 1x/2x 메뉴 막대 템플릿 `StatusBarIcon`, 라이트·다크 `AccentColor`가 포함됩니다. 일반 설정·메뉴 위젯·표준 앱 정보 패널에 로고를 적용합니다.

편집 가능한 SVG 원본과 재생성 스크립트는 `macOS/Branding`에 있습니다. `xcrun swift macOS/Branding/GenerateAssets.swift`로 카탈로그와 `resources/icon.icns` 내보내기를 같은 도형에서 재생성합니다. 앱 빌드는 카탈로그를 사용하며 별도 생성 스크립트 실행은 필요 없습니다.

Debug·Release의 **Standalone Icon File Behavior**는 **All**(`ASSETCATALOG_COMPILER_STANDALONE_ICON_BEHAVIOR = all`)입니다. 기본값은 일부 크기만 `AppIcon.icns`에 넣어 App Store 검증의 ‘512pt @2x 필수 아이콘 없음’ 오류를 일으킬 수 있습니다. 수정 전 아카이브는 자동 갱신되지 않으므로 새로 Archive한 항목으로 검증하세요.
`make build`·`make archive`는 `macOS/Branding/VerifyIcon.swift`로 결과 앱의 ICNS를 검사하며 512pt @2x 이미지가 없거나 1024×1024로 디코딩되지 않으면 실패합니다. 카탈로그의 PNG 존재 여부만으로 성공 처리하지 않습니다.


### 개편 내역

- Electron main/preload/renderer, IPC 브리지, 수동 큐, 폴더별 모드·필터·재귀 설정, 미리보기, 배치 Undo, Electron 의존성·패키징·DMG 배포 제거.
- SwiftUI 화면·AppKit 메뉴 막대, 단일 직렬 FSEvents 감시, security-scoped bookmark, identity 검증 Undo, 묶음·원자적 상태 저장으로 교체.
- 원본을 변경하지 않는 메뉴 막대 NFC ZIP 기능, 독립 아이콘 숨기기, 실제 시스템 로그인 항목 등록 추가.

## 웹 배포 · 광고 · 분석 · 검색 노출

- 공개 주소는 **https://nfd2nfc.com/** 입니다. `web/public/CNAME`, canonical, Open Graph, JSON-LD, sitemap의 주소를 이 도메인에 맞춥니다. GitHub Pages의 Custom domain도 `nfd2nfc.com`인지 확인하세요.
- `npm run web:build`는 초기 변환 화면·웹 사용법·CLI 설치법·FAQ를 **정적 HTML로 미리 렌더링**합니다. 브라우저는 이를 hydrate해 기존 변환 기능을 이어받습니다. JavaScript를 실행하지 않는 크롤러도 소개와 사용법을 읽을 수 있습니다. 개발 서버는 클라이언트 렌더링을 사용합니다.
- 같은 빌드에서 `/privacy/`, `/support/`를 독립적인 정적 HTML로 내보냅니다. 두 안내 페이지에는 광고·JavaScript·폼·외부 폰트가 없으며, JavaScript 없이 본문과 FAQ를 읽을 수 있습니다. 스타일과 아이콘은 같은 사이트에서 제공하며 호스팅 접속 기록은 별도입니다. sitemap에도 두 페이지를 포함합니다.
- 운영 빌드의 **변환기 홈페이지에서만** monolog과 같은 AdSense 게시자 `ca-pub-6070999186513755`의 자동 광고 코드를 한 번 로드합니다. `web/public/ads.txt`에 동일한 게시자를 선언합니다. 수동 슬롯 ID나 빈 광고 박스는 사용하지 않습니다. 개발 서버와 개인정보·지원 페이지에는 광고 코드를 넣지 않습니다.
- 운영 빌드의 **변환기 홈페이지에서만** Google Analytics 4 태그 `G-LVC6YHJFGK`를 `<head>`에 한 번 초기화합니다. 기존 AdSense와 같은 `web/vite.config.ts` 빌드 훅에서 삽입하므로 개발 서버와 `/privacy/`·`/support/`에는 분석 스크립트가 없습니다. 선택한 파일의 이름·경로·내용을 별도 Analytics 이벤트나 매개변수로 보내지 않습니다. 배포 후 브라우저에서 `gtag/js?id=G-LVC6YHJFGK` 로드와 동일한 `tid`의 `g/collect` 요청을 확인하고, 실제 집계는 Google Analytics 실시간 보고서에서 확인하세요.
- monolog과 같이 `data-overlays="bottom"`으로 앵커 광고를 하단에 고정합니다. 이 속성은 AdSense의 앵커 위치 설정을 덮어쓰며, 계정에서 앵커 광고를 꺼도 활성화할 수 있습니다. 앵커 광고를 끄려면 로더의 이 속성을 제거한 뒤 계정 설정을 사용하세요. [공식 앵커 동작 안내](https://support.google.com/adsense/answer/7478225)
- AdSense에서 **nfd2nfc.com 등록·승인과 Auto ads 활성화**를 확인하세요. 변환 조작을 방해하지 않도록 광고 미리보기에서 `#converter` 영역을 제외하는 설정을 권장합니다. 실제 광고 위치·빈도·게재 여부는 Google이 결정하며 코드만으로 보장하지 않습니다. [Auto ads 설정](https://support.google.com/adsense/answer/9261307)
- CSP는 `form-action 'none'`, `object-src 'none'`, `base-uri 'self'`, `worker-src 'self' blob:`를 유지합니다. 광고 통신을 막던 `connect-src 'none'` 등 리소스 제한은 제거했습니다. 정적 Pages에서 고정 nonce를 만들거나, 변경되는 Google 광고 도메인을 고정 목록으로 제한하지 않습니다. [AdSense CSP 공식 안내](https://support.google.com/adsense/answer/16283098)
- 페이지 하단과 `/privacy/`에 개인정보·광고·분석 처리 안내를 제공합니다. EEA·영국·스위스 사용자에게 개인 맞춤 광고를 제공하려면 AdSense의 개인정보 보호 및 메시지에서 Google 인증 CMP와 IAB TCF 통합 등 적용되는 동의 요건을 설정해야 합니다. Analytics 쿠키·분석에도 방문자 지역에 따른 고지·동의 요건을 별도로 확인해야 하며, 태그 설치만으로 동의 관리가 구성되지는 않습니다. [Google 동의 관리 요건](https://support.google.com/adsense/answer/13554116)
- SEO/AEO는 설명적인 한국어 제목·본문, 질문별 답변, 정확한 `WebSite`/`WebApplication` 구조화 데이터, 크롤링 허용, canonical과 sitemap으로 대응합니다. 존재하지 않는 평점·리뷰·FAQ 리치 결과를 꾸미거나 별도 AI 전용 파일을 추가하지 않습니다. [Google AI 검색 가이드](https://developers.google.com/search/docs/appearance/ai-features), [OpenAI 검색 크롤러 안내](https://developers.openai.com/api/docs/bots)
- 배포 후 Google Search Console·Bing Webmaster Tools·네이버 서치어드바이저에서 새 도메인의 소유권을 확인하고 **https://nfd2nfc.com/sitemap.xml**을 제출하세요. 인증값은 임의로 생성하지 않습니다. 이전 도메인을 운영하는 호스팅/DNS 제공자에서 새 도메인으로 301/308 리다이렉트를 설정하고, 해당되는 경우 Search Console 주소 변경도 제출하세요. CNAME 파일만으로 이전 별도 호스트의 리다이렉트를 설정할 수는 없습니다. [도메인 이전 공식 안내](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)
- 메타데이터·sitemap·크롤링 허용은 검색 순위, 색인, AI 답변 인용을 보장하지 않습니다.

## 기여

이 프로젝트에 기여하려면 다음 단계를 따르세요:

1. 이 저장소를 포크합니다.
2. 새로운 브랜치를 만듭니다: `git checkout -b feat/new-feature`
3. 변경 사항을 커밋합니다: `git commit -am 'Add new feature'`
4. 브랜치에 푸시합니다: `git push origin feat/new-feature`
5. PR을 만듭니다.

## 라이선스

이 프로젝트는 MIT 라이선스를 사용합니다.
