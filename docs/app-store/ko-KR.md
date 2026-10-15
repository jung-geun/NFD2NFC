# NFD2NFC 3.0.0 — 한국어 App Store Connect 제출 참조

대상은 **macOS 네이티브 앱 3.0.0**, 한국어 로케일 `ko-KR`입니다. 이 문서는 제출용 문안과 제출자가 확인할 항목을 분리합니다. 아래 `text` 블록은 해당 필드에 내용만 복사하세요. 설명은 HTML·Markdown 없는 일반 텍스트입니다. 블록 안에는 계정 정보용 임시 문구나 빈칸을 넣지 않았습니다.

**제출 완료를 뜻하지 않습니다.** 공개 지원·개인정보 페이지의 실제 배포와 외부 접속, 배포 서명, 업로드 및 Apple 심사는 이 문서 작성에서 검증하지 않았습니다. 제출 전 체크리스트를 완료해야 합니다. Apple의 최종 심사 승인을 보장하지 않습니다.[1][8]

## 1. 앱 식별과 권장 설정

| 항목 | 값 또는 처리 방법 |
| --- | --- |
| 플랫폼 | macOS |
| 네이티브 앱 버전 | `3.0.0` (`MARKETING_VERSION`) |
| 현재 프로젝트 빌드 번호 | `1` (`CURRENT_PROJECT_VERSION`); 실제 업로드 이력과 비교해 중복되지 않게 관리 |
| Bundle ID | `com.pieroot.nfd2nfc`; 개발자 계정의 App ID, 프로비저닝 및 App Store Connect 레코드와 일치 필요 |
| 앱 내부 표시 이름 | `NFD → NFC`; 아래 스토어용 이름과 구분 |
| 최소 OS | macOS 13.0 |
| Release 대상 | Apple Silicon 및 Intel universal; 실제 서명된 제출 아카이브에서 확인 필요 |
| 기본 언어 / 번역 | 한국어 / `ko-KR` 권장 |
| 기본 카테고리 | **유틸리티(Utilities)** 권장; plist의 `public.app-category.utilities`와 일치. 보조 카테고리는 필수로 추가하지 않음 |
| 로그인 | 필요 없음. App Review의 Sign-in required는 해제, 데모 계정·암호 입력 불필요 |
| 마케팅 URL | 선택 항목. 웹 변환기와 네이티브 앱의 기능을 구분해 안내할 것 |

`package.json`의 **2.0.3은 CLI·Node.js 패키지 버전**이며 네이티브 앱 3.0.0과 별개입니다. 앱 제출 때문에 패키지 버전을 변경하지 않습니다. App Store의 실제 Apple ID, SKU, 등록된 개발자/판매자 이름, 가격·판매 지역은 저장소에서 확인할 수 없으므로 임의로 생성하지 않습니다.[2]

## 2. 정확한 길이 측정

문자는 Python `len(text)`에 해당하는 **Unicode 코드 포인트 수**, 바이트는 `len(text.encode("utf-8"))`입니다. 공백·쉼표·문장부호·블록 내부 줄바꿈(LF)을 포함하며, 코드 펜스와 닫는 펜스 직전의 마지막 구분용 줄바꿈은 제외했습니다. 한국어 문안은 NFC로 작성했습니다. 아래 숫자는 그대로 제공한 문안의 측정값입니다. 수정하면 다시 측정하세요.

Apple Help는 키워드를 **100자 아닌 100바이트**, 심사 메모도 **4,000자 아닌 4,000바이트**로 규정합니다. 한국어는 대개 한 음절이 UTF-8 3바이트입니다. 이름·부제는 각각 30자, 프로모션 텍스트는 170자, 설명·새로운 기능은 각각 4,000자입니다.[1][2]

| 필드 | 문자 수 | UTF-8 바이트 수 | 적용 제한 |
| --- | ---: | ---: | --- |
| 앱 이름 | 19 | 33 | 30자 |
| 부제 | 19 | 41 | 30자 |
| 프로모션 텍스트 | 112 | 260 | 170자 |
| 설명 | 1,461 | 3,383 | 4,000자 |
| 키워드 | 34 | 90 | 100바이트 |
| 새로운 기능 | 474 | 953 | 4,000자 |
| 심사 메모 | 3,712 | 3,752 | 4,000바이트 |
| 지원 URL | 28 | 28 | 이 표의 문자 제한 대상 아님 |
| 개인정보 처리방침 URL | 28 | 28 | 이 표의 문자 제한 대상 아님 |
| 마케팅 URL | 20 | 20 | 이 표의 문자 제한 대상 아님 |
| 버전 | 5 | 5 | 형식: 숫자와 마침표 |

## 3. 스토어에 복사할 한국어 문안

### 앱 이름

App Information → Name. 이름의 사용 가능 여부와 타인의 권리는 제출 계정에서 최종 확인합니다.

```text
NFD2NFC - 한글 파일명 정리
```

### 부제

App Information → Subtitle.

```text
폴더 자동 감시와 원본 보존 ZIP
```

### 프로모션 텍스트

버전 메타데이터 → Promotional Text.

```text
한글 파일명의 자소 분리를 Mac에서 정리하세요. 선택한 폴더를 자동 감시하고, 변환 기록에서 이름을 개별로 되돌릴 수 있습니다. 메뉴 막대에서는 원본을 건드리지 않고 NFC 이름의 ZIP을 만듭니다.
```

### 설명

버전 메타데이터 → Description. 아래 전체를 일반 텍스트로 붙여넣으세요.

```text
한글 파일명, 공유하기 전에 깔끔하게.

NFD2NFC는 macOS에서 분리된 한글 파일·폴더 이름(NFD)을 조합된 이름(NFC)으로 정리하는 네이티브 앱입니다. 파일 내용은 그대로 두고 이름을 정규화합니다. macOS 13 이상에서 사용할 수 있습니다.

선택한 폴더를 자동으로 감시
실시간 감시에서 폴더를 추가하면 기존 항목을 검사하고, 이후 생성되거나 이동된 항목도 자동으로 처리합니다. 하위 폴더까지 감시하며, 선택한 최상위 폴더 자체의 이름은 바꾸지 않습니다. 감시 목록에서 폴더를 제거해도 실제 파일이나 폴더는 삭제하지 않습니다.

변환 기록과 개별 되돌리기
최근 최대 1,000건의 기록에서 파일명, 위치, 변환 시각을 확인하세요. Finder에서 위치를 열거나 전체 경로를 복사할 수 있습니다. 이름 변경은 항목별로 되돌릴 수 있으며, 파일 식별 정보를 확인한 뒤 처리합니다. 되돌린 항목은 같은 파일과 같은 이름인 동안 다시 자동 변환하지 않습니다.

원본을 보존하는 메뉴 막대 ZIP
메뉴 막대에서 파일·폴더를 선택하거나 끌어다 놓으면 ZIP 내부의 한글 이름을 NFC로 정리한 새 압축 파일을 만듭니다. 원본 파일의 이름과 내용은 바꾸지 않습니다. 결과는 사용자가 저장 권한을 허용한 Documents/NFD2NFC 폴더에 저장하며, 같은 이름의 ZIP이 있으면 번호를 붙여 덮어쓰지 않습니다. 기존 ZIP을 해제해 내부 이름을 고치는 기능은 아닙니다.

작업 방식에 맞는 설정
변환 알림을 켜거나 끄고 알림 간격을 조절할 수 있습니다. Dock 아이콘과 메뉴 막대 아이콘은 각각 숨길 수 있으며, 로그인 시 자동 실행도 설정할 수 있습니다. 창을 닫거나 두 아이콘을 모두 숨겨도 감시는 계속됩니다. 다시 설정하려면 Finder의 응용 프로그램에서 앱을 열고, 완전히 멈추려면 앱 메뉴나 메뉴 막대 메뉴에서 종료하세요.

선택한 권한 안에서, 기기 안에서
App Sandbox를 사용하며, 감시할 폴더와 ZIP 저장 위치는 사용자가 직접 선택해 접근을 허용합니다. 네이티브 앱은 파일을 서버에 업로드하지 않으며 계정이나 로그인이 필요하지 않습니다. 설정, 선택한 경로, 접근 권한 정보와 변환 기록은 Mac의 로컬 앱 컨테이너에 저장합니다. 네이티브 앱에는 광고나 분석 SDK가 없습니다. 외부 웹사이트 방문과 사용자가 직접 보내는 지원 문의는 별도 서비스의 개인정보 처리 대상입니다.

사용 전 확인하세요
실시간 감시는 원본 이름을 직접 바꾸므로 중요한 자료는 먼저 백업하고 별도의 테스트 폴더에서 확인하세요. 같은 이름의 다른 항목을 덮어쓰지 않으며 이름이 마침표(.)로 시작하는 숨김 항목과 심볼릭 링크는 감시 변환에서 제외합니다. ZIP 생성은 숨김 파일과 빈 폴더를 포함하지만 심볼릭 링크 등 지원하지 않는 항목이 있으면 오류를 표시합니다. Finder에서 보이는 글자 모양만으로 정규화 여부를 판단할 수 없으며, 압축을 해제한 파일명은 운영체제에 따라 다시 분해될 수 있습니다.
```

### 키워드

버전 메타데이터 → Keywords. 쉼표로 구분하고 쉼표 뒤 공백은 없습니다. 각 키워드는 3자 이상이며 앱 이름·개발자 이름·타사 상표를 반복하지 않았습니다. 90바이트이므로 100바이트 이내입니다.[1]

```text
자소분리,유니코드,정규화,압축파일,파일관리,이름변경,맥유틸리티
```

### 3.0.0의 새로운 기능

**업데이트 제출 때만 사용합니다.** Apple은 첫 App Store 버전에서는 이 필드를 제공하지 않으며, 이후 버전에는 필수로 요구합니다. 버전 번호가 3.0.0이어도 이 앱의 첫 App Store 등록이라면 붙여넣지 마세요. 과거 스토어 출시가 있었다고 가정하지 않습니다.[1]

```text
3.0.0에서는 macOS 앱을 SwiftUI·AppKit 기반 네이티브 앱으로 개편했습니다.

- 선택한 폴더와 하위 폴더를 FSEvents로 감시하고 한글 NFD 이름을 NFC로 정리합니다.
- 최근 최대 1,000건의 기록, Finder에서 위치 보기, 전체 경로 복사, 항목별 이름 되돌리기를 제공합니다.
- 메뉴 막대에서 파일·폴더를 선택하거나 드롭해 원본을 보존하는 NFC 이름의 ZIP을 만듭니다.
- 알림 간격, Dock·메뉴 막대 아이콘 표시, 로그인 시 자동 실행을 설정할 수 있습니다.

macOS 13 이상이 필요합니다. App Sandbox 적용으로 기존 Electron 앱에서 감시하던 폴더는 다시 선택해 권한을 허용해야 합니다. ZIP 저장 시에는 실제 Documents 또는 Documents/NFD2NFC 폴더의 접근 권한을 허용해주세요. 수동 변환 모드, 미리보기, 사용자 필터, 일괄 되돌리기는 제공하지 않습니다.
```

## 4. URL 필드와 공개 지원 연락처

아래는 현재 네이티브 `MainView.swift`에서 사용하는 정식 지원·개인정보 URL입니다. **공개 배포 상태는 아직 검증하지 않았습니다.** 문안에 사용할 주소이지, 현재 HTTP 성공이나 배포 완료를 주장하는 근거가 아닙니다. 제출 전에 실제 정책·지원 내용이 있는 페이지로 공개하고 로그인 없이 외부에서 접근되는지 확인해야 합니다. 홈으로 잘못 돌아가는 리다이렉트나 빈 페이지도 해결해야 합니다.[1][3][8]

### 지원 URL

Support URL. 실제 사용법·문제 해결 안내와 연락 수단이 있어야 합니다.

```text
https://nfd2nfc.com/support/
```

### 개인정보 처리방침 URL

Privacy Policy URL. 네이티브 앱과 웹사이트/지원 문의의 처리 범위를 명확히 구분해야 합니다.

```text
https://nfd2nfc.com/privacy/
```

### 마케팅 URL

Marketing URL, 선택 항목. 홈페이지의 웹 변환기와 광고 동작을 네이티브 앱의 기능으로 오인시키지 마세요.

```text
https://nfd2nfc.com/
```

공개 지원 이메일은 `package.json`의 author에 기재된 **pieroot.02@gmail.com**, 이슈 접수 주소는 **https://github.com/jung-geun/NFD2NFC/issues** 입니다. 공개 이슈에 원본 파일, 실명 경로, 접근 북마크, 민감한 로그를 올리도록 요구하지 마세요. 이 공개 이메일을 심사 연락처로 쓸지는 사용자 본인이 수신·대응 가능 여부를 확인해야 합니다. 공개 author 이름을 법적 성명이나 Account Holder 이름으로 간주하지 않습니다.

네이티브 앱의 **일반 → 지원 및 개인정보** 섹션은 앱 헤더 바로 아래에 있으며 **지원 및 문의**, **개인정보 처리방침** 링크를 제공합니다. 소스는 SwiftUI `Link`로 외부 기본 브라우저를 엽니다. 인앱 링크 구현과 실제 제출 바이너리에서 링크가 열리는지, 그리고 링크 대상 공개 배포의 성공 여부는 별개입니다. 개인정보 정책을 App Store Connect뿐 아니라 앱 안에서도 쉽게 접근하도록 확인하세요(심사 지침 5.1.1(i)).[8]

## 5. App Review Notes — 영어 복사본

App Review Information → Notes. 아래 전체는 **3,712자 / UTF-8 3,752바이트**로 4,000바이트 이내입니다. 한국어 UI의 탭 순서와 실제 테스트 명령을 포함합니다. Python 3는 리뷰용 샘플 생성·코드 포인트 확인 도구일 뿐 앱 설치 요건이 아닙니다. 실제 파일을 바꾸므로 리뷰어에게 별도 테스트 폴더만 선택하도록 안내합니다. 이 작업에서 첫 번째 Python 샘플 생성 명령을 실행해 실제 NFD 이름과 샘플 내용을 확인했습니다. 이는 아래 네이티브 감시·ZIP 심사 시나리오 전체의 통과를 뜻하지 않습니다.

```text
NFD2NFC 3.0.0 is a native macOS 13+ SwiftUI/AppKit utility. No account, sign-in, credentials, subscription, or backend is required. Python 3 is only for the optional test below, not an app runtime dependency.

1. Use disposable files only: watching renames originals. In Terminal, create a unique test folder in your home directory (not your whole Documents folder):
python3 - <<'PY'
from pathlib import Path
import tempfile, unicodedata, os
p = Path(tempfile.mkdtemp(prefix="NFD2NFC-review-", dir=Path.home()))
n = unicodedata.normalize("NFD", "\ud55c\uae00 \ud14c\uc2a4\ud2b8.txt")
(p / n).write_bytes(b"NFD2NFC review sample\n")
actual = os.listdir(os.fsencode(p))[0].decode("utf-8")
assert actual == unicodedata.normalize("NFD", actual)
assert actual != unicodedata.normalize("NFC", actual)
print(p)
print("Before:", [hex(ord(c)) for c in actual])
PY
Copy the printed folder path. In the Watching tab (first tab), click Add Folder and choose only that folder. The initial scan and subsequent filesystem events normalize Hangul NFD names recursively. The selected root is not renamed. Dot-prefixed hidden entries and symlinks are excluded; collisions do not overwrite files.

2. After conversion, verify actual directory-entry code points and unchanged content, not Finder's visual rendering:
python3 -c 'from pathlib import Path
import unicodedata, os
p = Path(input("Paste test folder path: "))
n = os.listdir(os.fsencode(p))[0].decode("utf-8")
print("After:", [hex(ord(c)) for c in n])
assert n == unicodedata.normalize("NFC", n)
assert (p / n).read_bytes() == b"NFD2NFC review sample\n"'
History (second tab) shows up to 1,000 recent records, Finder reveal, path copy, and per-item undo. Undo checks file identity; an unchanged reverted identity/name is excluded from reconversion. Remove this watch before the ZIP test; removal does not delete the folder.

3. Click the menu-bar icon, then select or drop that test folder. On first ZIP use, authorize the real ~/Documents or ~/Documents/NFD2NFC via the app's folder picker. An unrelated folder or sandbox-container Documents is not accepted. Output is ~/Documents/NFD2NFC/NFD2NFC.zip, then NFD2NFC (2).zip, etc. ZIP creation preserves original names and contents; pre-existing ZIP inputs are not unpacked. Hidden files and empty folders are included; unsupported entries such as symlinks produce an error.
To check the ZIP's internal names without Finder extraction:
python3 -c 'from zipfile import ZipFile
import unicodedata
with ZipFile(input("Paste output ZIP path: ")) as z:
    for n in z.namelist():
        print(ascii(n))
        assert n == unicodedata.normalize("NFC", n)
        if not n.endswith("/"):
            assert z.read(n) == b"NFD2NFC review sample\n"'

4. General (third tab) controls local notifications (default interval 30s, minimum 1s), independent Dock/menu-bar visibility, and launch at login via macOS Login Items. Denying notification permission does not block conversion. File access is limited to user-selected read/write grants and app-scoped bookmarks; no Full Disk Access is required. Re-select a folder if its saved grant expires. Settings, paths, bookmarks and history stay in the local sandbox container; no uploads, ads or analytics SDKs are included.

Closing the window does not quit. Watching continues even with both icons hidden. Reopen NFD2NFC from Applications to restore the existing window. Quit via the app menu (Cmd-Q) or menu-bar Quit to stop watching. Launch at login is not a daemon that restarts a manually quit app. In General, the Support and Privacy section (지원 및 개인정보) is below the app header. Click 지원 및 문의 or 개인정보 처리방침 to open the support page or privacy policy in the default external browser.
```

샘플은 Python 표준 라이브러리 `unicodedata.normalize("NFD", ...)`로 실제 분해형 이름을 만듭니다. 초기 파일명과 변환 후 디렉토리 엔트리를 UTF-8에서 읽어 코드 포인트로 확인하고, ZIP은 압축 해제가 아닌 내부 엔트리 이름을 확인합니다. Finder에서 한글이 똑같이 보이는 것은 정규화의 증거가 아닙니다. 검증 단계는 되돌리기 전에 실행하세요. ZIP 검증은 생성한 테스트 폴더 하나만 압축했을 때를 전제로 합니다. 실제 출력 파일은 메뉴 막대의 결과/Finder에서 확인해 경로를 입력하면 되며 문안의 임시 경로를 바꿀 필요가 없습니다.

## 6. 스크린샷 — 실제 파일 5장과 업로드 순서

업로드 대상 폴더: **`assets/app-store/ko-KR/mac/2880x1800/`**. 한국어 Mac 로케일에 다음 순서로 올립니다.

| 순서 | 파일 | 전달할 기능 |
| ---: | --- | --- |
| 1 | `01-overview.png` | 앱 개요 / 첫 화면 |
| 2 | `02-folder-watching.png` | 선택 폴더의 실시간 감시 |
| 3 | `03-menu-bar-zip.png` | 원본 보존 메뉴 막대 ZIP |
| 4 | `04-history-and-undo.png` | 변환 기록과 항목별 되돌리기 |
| 5 | `05-preferences.png` | 일반 설정 |

Apple이 허용하는 Mac 규격에는 **2880 × 1800, 16:10**이 포함됩니다. 이번 작업에서 5장 모두 **2880 × 1800 PNG, RGB/sRGB, 알파 채널·투명도 없음**을 확인했고, 5번은 지원·개인정보 링크가 표시되는 최신 일반 설정 화면으로 갱신했습니다. 최종 제출 바이너리 UI와의 일치 및 개인정보 노출 여부는 제출 직전에도 확인하세요. `assets/app-store/preview-ko-KR.jpg`는 묶음 미리보기이며 위 5장 대신 업로드하지 않습니다. `captures/`의 원본 캡처나 예전 Electron 화면도 이 세트와 혼동하지 마세요. 이후 설정 UI가 바뀌면 해당 이미지도 최종 제출 전에 일치시켜야 합니다.[4][8]

## 7. App Privacy 권장 답변과 근거

### 현재 네이티브 앱: Data Not Collected 권장

App Store Connect의 App Privacy에서, 현재 네이티브 앱 코드의 범위에는 **데이터를 수집하지 않음(Data Not Collected)** 을 권장합니다. 수집하지 않는 데이터에 연결·추적 목적을 임의로 선택하지 마세요. 권한 있는 제출자가 실제 배포 바이너리와 운영 방식을 확인한 뒤 답변을 저장·게시해야 하며, 아래 근거가 바뀌면 답변도 갱신해야 합니다.[3]

- `macOS/NFD2NFC/NFD2NFC.entitlements`: App Sandbox, 사용자 선택 파일 읽기/쓰기, app-scoped bookmark만 선언합니다. 네트워크 클라이언트 권한이 없습니다.
- `AppModel.swift`: 폴더 접근은 `NSOpenPanel`/security-scoped bookmark로 허용받습니다. 변환·ZIP 생성은 로컬 작업이며 로그인, 파일 업로드, 앱 내 문의 전송 경로가 없습니다. 알림은 `UNUserNotificationCenter`의 로컬 알림이지 원격 푸시 서버 등록이 아닙니다.
- `StateStore.swift`: 설정, 선택 경로/북마크, 기록과 되돌리기 제외 정보는 앱 컨테이너의 `Application Support/NFD2NFC/state.json`에 저장됩니다. 기록은 최대 1,000건입니다. 기기 안에서만 처리·보관하는 데이터는 Apple의 수집 정의와 구분됩니다.
- `macOS/Package.swift` 및 네이티브 소스: 광고·분석 SDK나 서버 업로드 클라이언트를 포함하지 않습니다. `MainView.swift`의 정책·지원 링크는 외부 브라우저를 열며 앱 안에 광고 웹뷰를 삽입하는 구현이 아닙니다.
- `PrivacyInfo.xcprivacy`: `NSPrivacyTracking = false`, 추적 도메인과 수집 데이터 유형 배열은 비어 있습니다. 이는 위 구현과 함께 판단할 근거이지 manifest 하나만으로 모든 운영상의 수집 부재를 증명하는 것은 아닙니다.

Apple은 기기 밖으로 전송되어 개발자 또는 제3자가 실시간 요청 처리에 필요한 기간보다 오래 접근할 수 있는 경우를 수집으로 정의합니다. 로컬 파일 접근·북마크 저장·변환 기록만으로 서버 수집이라고 답하지 않습니다. 반대로 현재 앱에 없던 전송 SDK·진단 업로드 등을 추가한다면 파일명이나 경로도 데이터가 될 수 있으므로 다시 평가해야 합니다.[3]

### 웹사이트 및 지원 문의와 엄격히 구분

**Data Not Collected는 네이티브 앱의 권장 라벨이지, nfd2nfc.com·Gmail·GitHub 전체가 아무 정보도 받지 않는다는 선언이 아닙니다.** 별도 웹 변환기 홈페이지의 production 설정은 Google AdSense 스크립트를 포함합니다(`web/vite.config.ts`). 브라우저 내 파일 변환이 파일 업로드를 하지 않는 것과 광고의 외부 통신·쿠키·IP/기기 정보 처리는 별개입니다. 웹 호스팅 제공자의 요청 로그도 구분해 정책에 설명해야 합니다. 지원/정책 페이지의 외부 스크립트 포함 여부와 실제 배포 내용 역시 확인해야 합니다.

사용자가 이메일이나 GitHub 이슈를 직접 보내면 문의 내용, 이메일/계정 식별자, 자발적으로 첨부한 경로·로그·파일이 해당 서비스와 지원 담당자에게 전달될 수 있습니다. 이는 현재 네이티브 바이너리의 자동 수집 경로가 없다는 근거와 별도로 공개 정책에 설명합니다. 앱 내부 폼·자동 로그 첨부·업로드로 연결되는 운영 흐름이 생기면 App Privacy도 다시 검토합니다. **“지원 문의는 언제나 신고 제외”라는 규칙은 없습니다.** Apple의 선택적 공개 예외는 비추적, 광고/마케팅/기타 목적 미사용, 드물고 선택적이며 핵심 기능 밖에서의 수집, 그리고 앱 인터페이스에서 수집 사실을 명확히 하고 사용자 이름/계정 이름을 제출 정보와 함께 두드러지게 표시하며 매번 적극적으로 제출을 선택한다는 조건을 **모두** 충족해야 합니다. 일부만 충족하면 공개해야 합니다.[3]

### Privacy manifest와 App Privacy는 별개

`macOS/NFD2NFC/PrivacyInfo.xcprivacy`는 바이너리에 포함할 기술 선언입니다. 현재 파일 타임스탬프 API의 이유는 `3B52.1`, `C617.1`이며, 수집 데이터 유형과 추적 선언과는 다른 항목입니다. 아카이브에 포함되는지와 실제 API 사용 이유의 적합성을 확인하세요. **manifest를 넣었다고 App Store Connect의 App Privacy 설문이 자동 완료되거나 개인정보 정책 URL이 대체되지 않습니다.** App Privacy 답변 게시, 공개 개인정보 정책, manifest 확인을 각각 수행해야 합니다.[3][7]

앱을 지운다고 설정·기록이 반드시 자동 삭제된다거나 ZIP이 자동 만료된다고 안내하지 않습니다. 네이티브 ZIP은 사용자가 저장한 파일입니다. 웹 버전의 100MiB 제한·5분 다운로드 만료를 네이티브 앱 설명에 적용하지 않습니다.

## 8. 사용자가 직접 공급·확인해야 하는 계정/법적 정보

다음은 저장소만으로 확정할 수 없는 **제출 전 차단 항목**입니다. 복사용 문안 안에 가짜 이름·전화번호·주소를 넣지 않았습니다. 실제 값은 사용자/권한 있는 계정 담당자가 App Store Connect에 입력해야 합니다.

1. **App Review 연락처:** 실제 연락 담당자의 이름/성, 수신 가능한 이메일, 국가 코드와 `+`를 포함한 국제 형식 전화번호. 공개 지원 이메일을 사용하려면 담당자가 직접 확인하세요. 데모 로그인 정보와 별개로 리뷰 연락처는 필요합니다.[1]
2. **Account Holder/판매자와 법적 실체:** 개인 또는 법인 등록 정보, 실제 법적 성명/조직 이름, 필요한 주소·사업자/세금 정보와 계약 권한. 저장소 author, 서명 팀 ID 또는 이메일에서 법적 신원을 추정하지 않습니다. 제출 계정에서 실제 개발자 표시 이름도 확인합니다.
3. **DSA trader 자기평가:** 무료/오픈소스라는 이유만으로 non-trader를 단정하지 않습니다. EU에 배포하지 않더라도 trader 상태 선언은 필요합니다. trader라면 개인은 주소 또는 사서함·전화·이메일, 조직은 D-U-N-S 주소 및 전화·이메일, Apple이 요구하는 검증 문서와 미입력 결제 계정 정보를 실제 값으로 공급해야 합니다. EU 스토어에 공개될 연락처라는 점을 확인하세요. 관련 역할은 Account Holder/Admin입니다.[6]
4. **한국 및 선택 판매 지역의 법적 정보:** 계정 유형·판매 방식·지역에 따라 App Store Connect가 요구하는 사업자/통신판매·허가·세무 정보를 실제 자격으로 확인합니다. 존재하지 않는 등록 번호를 만들거나 모두 면제라고 가정하지 않습니다.
5. **저작권:** `LICENSE`에는 `Copyright (c) 2024 jung-geun`이 있습니다. 이것이 현 앱 전체의 독점 권리자 표기와 정확히 일치하는지 사용자에게 확인받아야 합니다. Apple 필드는 권리 취득 연도와 실제 권리자 이름을 요구하고 ©는 자동 추가합니다. 현재 연도를 기계적으로 넣거나 새로운 법인명을 만들지 않습니다. 확인 전에는 확정 복사 블록을 제공하지 않습니다.[1]
6. **계정 레코드/사업 결정:** 등록 가능한 앱 이름, SKU, Apple이 발급하는 Apple ID, 현재 Bundle ID 소유권, 서명 팀/인증서/프로비저닝, 업로드 빌드 번호, 가격·판매 지역·출시 방식, 적용 계약·세금/은행 정보. SKU/Apple ID를 임의로 확정하거나 스토어 링크를 만들어내지 않습니다.[2]
7. **개인정보 정책의 운영 사실:** 공개 페이지는 저장소에 공개된 개발자 표기와 이메일, 확인 가능한 기술 동작을 기준으로 작성했습니다. 게시 전에 정식 운영자·개인정보 보호책임자 신원과 필요한 연락처, 실제 문의 정보의 처리 근거·보유 및 삭제 기준, Gmail/GitHub 등 제공자의 계약상 역할과 적용되는 국외이전 고지사항을 확인하세요. 확인되지 않은 법적 성명·처리 국가·수탁 계약·고정 보유기간을 임의로 넣지 않았습니다. 공개 정책을 실제 운영과 일치시키는 책임은 운영자에게 있습니다.

## 9. 제출 직전 릴리스 체크리스트

다음 항목은 **완료 기록이 아니라 제출자가 실행할 체크리스트**입니다.

- [ ] 지원·개인정보 URL을 실제 배포하고 외부 환경에서 HTTPS로 접속한다. 로그인·권한 요청 없이 실질적인 본문이 열리는지, 빈 페이지·404·잘못된 리다이렉트가 없는지 확인한다. 지원 페이지에 실제 연락 수단을, 정책에 네이티브/웹/지원 문의의 구분과 로컬 보관 사실을 포함한다.[1][3][8]
- [ ] 최종 제출 앱에서 일반 → 지원 및 개인정보의 두 링크를 직접 연다. 외부 기본 브라우저에서 각각 올바른 지원·정책 페이지가 열리고 앱 안에서 쉽게 찾을 수 있는지 확인한다. 소스 링크 존재만으로 검증을 대체하지 않는다.[8]
- [ ] 최종 앱의 폴더 추가, 초기 스캔/후속 감시, 기록·개별 되돌리기, ZIP 원본 보존/실제 Documents 저장 권한, 알림 거부, 아이콘 숨김·재열기·종료·로그인 항목을 별도 테스트 자료로 확인한다. 네이티브/웹/CLI 기능을 혼동한 문구와 스크린샷이 없는지 확인한다.
- [ ] 유효한 배포 서명·스토어 프로비저닝으로 **Release universal(arm64 + x86_64)** 빌드와 아카이브를 만든다. `make archive`/`make export` 또는 Xcode Organizer의 App Store Connect 배포 경로를 사용하고, 실제 결과의 아키텍처·서명·샌드박스·리소스/manifest 포함을 확인한다. 로컬 ad-hoc `make build` 성공을 스토어 서명·업로드 성공으로 간주하지 않는다.
- [ ] App Store Connect의 macOS 레코드와 Xcode/App ID/프로비저닝의 `com.pieroot.nfd2nfc`, 앱 버전 `3.0.0`, 중복되지 않는 빌드 번호를 일치시킨다. SKU/Apple ID와 팀 소유권을 계정에서 확인하고 업로드 처리된 정확한 빌드를 선택한다. `package.json`/CLI 버전은 **2.0.3 그대로 유지**한다.[2]
- [ ] 한국어 Name/Subtitle/Promotional Text/Description/Keywords 및 URL을 해당 필드에 넣는다. What's New는 업데이트 제출일 때만 사용한다. 실제 App Store 미출시라면 3.0.0이더라도 첫 릴리스 절차를 따른다.[1]
- [ ] 위 5장을 지정 순서로 업로드하고 실제 규격, 투명도 없음, 최종 UI 일치 및 민감한 정보 노출 없음을 확인한다.[4]
- [ ] App Privacy에서 최종 바이너리·SDK·문의 운영 흐름을 확인해 답변을 저장·게시한다. 현재 코드의 권장값은 Data Not Collected이다. 개인정보 정책 URL과 manifest 검토는 별도로 완료한다.[3][7]
- [ ] **App Information → Age Ratings의 실제 최신 설문**에서 인앱 제어, 기능, 콘텐츠의 빈도를 항목별로 답하고 Apple이 산출한 전 세계/지역별 결과를 검토한다. 유틸리티라는 이유로 숫자 등급을 미리 정하지 않는다. 외부 지원 링크와 앱 내 공개 웹 탐색 기능을 구분하며, 임의로 모든 답을 일괄 선택하지 않는다.[5]
- [ ] Utilities 카테고리와 plist가 일치하는지 확인하고, 콘텐츠 권리·수출/암호화 관련 질문을 실제 바이너리와 권리 자료에 근거해 답한다. 적용 계약, 판매 지역·가격·출시 방식을 사용자 결정과 일치시킨다.[2]
- [ ] LICENSE의 `2024 jung-geun`을 실제 권리자/취득 연도와 대조해 저작권 필드를 확정한다. 심사 연락 담당자 이름·이메일·국제 전화번호, 법적/사업자 정보, DSA 상태·필요한 증빙을 실제 값으로 완료한다.[1][6]
- [ ] 위 영어 Notes를 붙여넣고 Sign-in required가 해제되어 있는지 확인한다. 존재하지 않는 테스트 계정이나 인증 정보를 만들지 않는다. 사용 가능한 문의 응답 체계와 공개 페이지를 심사 기간에도 유지한다.[1][8]
- [ ] Organizer 검증·업로드 결과와 App Store Connect의 빌드 처리/제출 상태를 직접 확인한다. 오류·미완료 질문을 해결한 뒤 제출한다. 빌드 성공, 본 문서 작성, 메타데이터 제한 준수만으로 Apple의 승인이나 출시를 보장하지 않는다.[8]

### 이번 작업에서 확인한 범위

- `npm run web:build`, `npx tsc --noEmit --project web/tsconfig.json`, 로컬 ad-hoc `make build`가 통과했습니다. 실제 Release 실행 파일의 `arm64`·`x86_64` 아키텍처와 ICNS의 512pt @2x 1024×1024 이미지를 확인했습니다. App Store 배포 서명이나 아카이브 업로드 검증은 아닙니다.
- 운영 빌드의 로컬 미리보기를 실제 Chromium에서 열어 1440×1000·390×844 화면, 라이트·다크 테마, 내부 링크·목차·메일 연락처·가로 넘침을 확인했습니다. 정책·지원 페이지는 JavaScript를 꺼도 읽을 수 있고, 스크립트·폼·외부 자원 요청이 없었습니다. FAQ의 Enter 열기·닫기와 본문 건너뛰기 키보드 포커스도 확인했습니다.
- 홈페이지의 정적 본문과 하단 지원 링크가 동작하고 광고 로더는 홈페이지에만 한 개 포함되는 것을 확인했습니다. hydrate 후 실제 NFD 샘플 파일을 변환하여 생성된 ZIP의 NFC UTF-8 이름, CRC와 원본 내용 보존을 확인했습니다.
- 별도 상태 저장소를 사용하는 샌드박스 UI 스모크에서 실제 `MainView`의 지원·개인정보 링크를 눌러 대상 URL을 확인했습니다. 외부 URL 실행은 테스트용 `OpenURLAction`으로 기록했으므로 공개 사이트 접속 성공이나 최종 배포 바이너리의 외부 브라우저 실행을 검증한 것은 아닙니다. 사용자 감시 폴더나 로그인 항목은 변경하지 않았습니다.
- **미검증:** 공개 HTTPS 배포·외부 접속, 유효한 스토어 서명의 최종 아카이브, App Store Connect 업로드·제출·심사. 위 체크리스트는 이 로컬 검증과 별도로 수행해야 합니다.

## 10. 근거 소스와 Apple 1차 문서

### 저장소 근거

- `README.md`: 현재 네이티브 기능·권한·ZIP 동작·백그라운드 동작, 웹/CLI와의 차이, 빌드 경로.
- `package.json`: CLI/패키지 `2.0.3`, 공개 author 이메일, GitHub 지원 이슈 주소.
- `macOS/NFD2NFC.xcodeproj/project.pbxproj`: `MARKETING_VERSION = 3.0.0`, Bundle ID, 빌드 번호와 Release 설정.
- `macOS/NFD2NFC/Info.plist`, `NFD2NFC.entitlements`, `PrivacyInfo.xcprivacy`: 내부 이름/카테고리/OS, 샌드박스 권한, 추적·수집·API 이유 선언.
- `macOS/NFD2NFC/AppModel.swift`, `StateStore.swift`, `MainView.swift`, `AppDelegate.swift`: 기능·권한·로컬 저장·지원 링크·재열기/종료의 실제 구현.
- `macOS/Package.swift`: 네이티브 코어 패키지 구성. `web/vite.config.ts`: 별도 웹 홈페이지의 광고 주입 설정.
- `LICENSE`: 현재 저장소의 권리자 표기. `assets/app-store/ko-KR/mac/2880x1800/`: 업로드할 실제 5장.

### Apple 공식 문서

1. [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/) — 프로모션/설명/키워드/새로운 기능의 제한, 지원 URL, 저작권, 심사 메모·연락처·로그인 정보.
2. [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/) — 이름·부제 30자, 필수 정책 URL, Bundle ID/SKU/Apple ID, 카테고리와 권리 정보.
3. [App privacy details on the App Store](https://developer.apple.com/app-store/app-privacy-details/) — 수집의 정의, 온디바이스 처리, 선택적 공개의 모든 조건, 공개 정책 링크.
4. [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) — Mac 16:10 크기, 허용 파일 형식, 투명도/알파 제한.
5. [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) — 실제 설문과 국가·지역별 산출 등급 확인.
6. [Manage European Union Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/) — trader 자기평가, 공개 연락처, 역할과 확인 절차.
7. [Privacy manifest files](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files) — 번들 manifest의 목적과 수집 데이터/API 이유 선언.
8. [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) — 제출 전 준비, 1.5 연락처, 2.1 완성도·작동 URL, 2.3 정확한 메타데이터, 5.1.1(i) 앱 안의 개인정보 정책 접근. 체크리스트는 승인을 보장하지 않음.
