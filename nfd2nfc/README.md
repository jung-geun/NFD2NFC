# 파일 이름 변환기

백그라운드에서 파일을 감지하고 변환하여 파일 이름을 NFD에서 NFC 인코딩으로 자동 변환하는 macOS 패키지입니다.

npm 패키지는 명령어를 통해 사용할 수 있는 CLI 도구를 제공합니다.
Application 패키지는 macOS에서 백그라운드 프로세스로 실행되며, 파일 변환을 자동으로 처리합니다.

## 특징

- 자동 파일 감지
- 백그라운드 변환 프로세스
- NFD에서 NFC 변환 지원

## 설치

```bash
# 설치 지침을 여기에 작성하세요
npm install -g @pieroot/nfd2nfc
# or
npm i @pieroot/nfd2nfc
```

## 사용법

```bash
nfd2nfc [options] <path>

Options:
  -V, --version  output the version number
  -h, --help     display help for command
```

## 라이선스

MIT 라이선스
