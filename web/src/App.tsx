import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent, type RefObject } from 'react';
import {
  collectFromDataTransfer,
  collectFromFileList,
  type CollectProgress,
  type CollectResult,
  type CollectSummary,
} from './lib/collectFiles';
import { buildZip, type BuildProgress } from './lib/buildZip';
import { ProcessingPipeline, type WorkflowProgress } from './ProcessingPipeline';
import { deferred } from './lib/deferred';
import { PROCESSING_LIMIT_LABEL, RESULT_LIFETIME_MS } from './lib/resourcePolicy';

type State =
  | { kind: 'idle'; dragActive: boolean; error?: string; notice?: string }
  | { kind: 'working'; progress: WorkflowProgress; collected?: CollectSummary }
  | {
      kind: 'ready';
      progress: WorkflowProgress;
      collected: CollectSummary;
      zipBytes?: number;
      downloadUrl?: string;
      filename: string;
      expiresAt: number;
    };

type Action =
  | { type: 'drag'; active: boolean }
  | { type: 'start' }
  | { type: 'collect-progress'; progress: CollectProgress }
  | { type: 'error'; message: string }
  | { type: 'packing-start'; collected: CollectSummary }
  | { type: 'build-progress'; progress: BuildProgress }
  | { type: 'linking' }
  | { type: 'ready'; collected: CollectSummary; zipBytes: number; downloadUrl: string; filename: string; expiresAt: number }
  | { type: 'ready-empty'; collected: CollectSummary; filename: string; expiresAt: number }
  | { type: 'reset' }
  | { type: 'expire' };

const initial: State = { kind: 'idle', dragActive: false };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'drag':
      return state.kind === 'idle' ? { ...state, dragActive: action.active } : state;
    case 'start':
      return { kind: 'working', progress: { phase: 'reading', done: 0, archiveCount: 0 } };
    case 'collect-progress':
      return state.kind === 'working' ? { ...state, progress: action.progress } : state;
    case 'error':
      return { kind: 'idle', dragActive: false, error: action.message };
    case 'packing-start':
      return {
        kind: 'working',
        collected: action.collected,
        progress: {
          phase: 'compressing',
          done: 0,
          total: action.collected.files.length,
          archiveCount: action.collected.archiveCount,
        },
      };
    case 'build-progress':
      if (state.kind !== 'working') return state;
      return { ...state, progress: { ...state.progress, ...action.progress, phase: 'compressing' } };
    case 'linking':
      if (state.kind !== 'working') return state;
      return {
        ...state,
        progress: { phase: 'linking', done: 0, archiveCount: state.progress.archiveCount },
      };
    case 'ready':
    case 'ready-empty':
      return {
        kind: 'ready',
        collected: action.collected,
        filename: action.filename,
        expiresAt: action.expiresAt,
        zipBytes: action.type === 'ready' ? action.zipBytes : undefined,
        downloadUrl: action.type === 'ready' ? action.downloadUrl : undefined,
        progress: {
          phase: action.type === 'ready' ? 'ready' : 'empty',
          done: action.collected.files.length,
          total: action.collected.files.length,
          archiveCount: action.collected.archiveCount,
        },
      };
    case 'reset':
      return initial;
    case 'expire':
      return { kind: 'idle', dragActive: false, notice: '결과 보관 시간이 지나 임시 파일과 다운로드 링크를 자동 해제했습니다. 파일을 다시 선택해주세요.' };
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const busy = useRef(false);
  const restorePickerFocus = useRef(false);
  const mounted = useRef(false);
  const resultResource = useRef<{ downloadUrl?: string; expiresAt: number } | null>(null);
  const delayedRevocations = useRef(new Map<string, number>());
  const fileInput = useRef<HTMLInputElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLDivElement>(null);
  const expiresAt = state.kind === 'ready' ? state.expiresAt : undefined;

  const releaseResult = useCallback((delay = 0) => {
    if (!delay) {
      for (const [url, timer] of delayedRevocations.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      delayedRevocations.current.clear();
    }
    const resource = resultResource.current;
    resultResource.current = null;
    if (!resource?.downloadUrl) return;
    const url = resource.downloadUrl;
    if (delay) {
      const timer = window.setTimeout(() => {
        delayedRevocations.current.delete(url);
        URL.revokeObjectURL(url);
      }, delay);
      delayedRevocations.current.set(url, timer);
    } else URL.revokeObjectURL(url);
  }, []);

  const forgetResult = useCallback((reason: 'reset' | 'expire' | 'pagehide') => {
    // Safari needs a brief grace period if reset immediately follows a download click.
    releaseResult(reason === 'reset' ? 1_000 : 0);
    restorePickerFocus.current = true;
    dispatch({ type: reason === 'expire' ? 'expire' : 'reset' });
  }, [releaseResult]);

  useEffect(() => {
    mounted.current = true;
    const onPageHide = () => {
      if (resultResource.current) forgetResult('pagehide');
      else releaseResult();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', onPageHide);
      releaseResult();
    };
  }, [releaseResult, forgetResult]);

  useEffect(() => {
    if (expiresAt === undefined) return;
    const checkExpiry = () => {
      if (resultResource.current?.expiresAt === expiresAt && Date.now() >= expiresAt) forgetResult('expire');
    };
    const timer = window.setTimeout(checkExpiry, Math.max(0, expiresAt - Date.now()));
    // Background tabs may suspend timers. Recheck the absolute deadline on return.
    document.addEventListener('visibilitychange', checkExpiry);
    window.addEventListener('focus', checkExpiry);
    window.addEventListener('pageshow', checkExpiry);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('focus', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
    };
  }, [expiresAt, forgetResult]);

  const handleDownload = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (!resultResource.current || Date.now() >= resultResource.current.expiresAt) {
      event.preventDefault();
      forgetResult('expire');
    }
  }, [forgetResult]);

  const error = state.kind === 'idle' ? state.error : undefined;
  useEffect(() => {
    if (state.kind === 'ready') resultHeading.current?.focus();
    if (error) errorMessage.current?.focus();
    if (state.kind === 'idle' && restorePickerFocus.current) {
      fileInput.current?.focus();
      restorePickerFocus.current = false;
    }
  }, [state.kind, error]);

  const reportCollection = useCallback((progress: CollectProgress) => {
    dispatch({ type: 'collect-progress', progress });
  }, []);

  const run = useCallback(async (collect: () => Promise<CollectResult>) => {
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: 'start' });
    try {
      // Call synchronously: drag-and-drop handles must be captured during the drop event.
      const collected = await collect();
      if (!mounted.current) return;
      const summary: CollectSummary = {
        ...collected,
        files: collected.files.map(({ zipPath, originalPath, normalized }) => ({ zipPath, originalPath, normalized })),
      };
      const filename = `nfc-${timestamp()}.zip`;
      if (collected.files.length === 0) {
        const expiresAt = Date.now() + RESULT_LIFETIME_MS;
        resultResource.current = { expiresAt };
        dispatch({ type: 'ready-empty', collected: summary, filename, expiresAt });
        return;
      }
      dispatch({ type: 'packing-start', collected: summary });
      await allowPaint();
      const blob = await buildZip(collected.files, (progress) => {
        dispatch({ type: 'build-progress', progress });
      });
      dispatch({ type: 'linking' });
      await allowPaint();
      if (!mounted.current) return;
      const downloadUrl = URL.createObjectURL(blob);
      const expiresAt = Date.now() + RESULT_LIFETIME_MS;
      resultResource.current = { downloadUrl, expiresAt };
      dispatch({ type: 'ready', collected: summary, zipBytes: blob.size, downloadUrl, filename, expiresAt });
    } catch (e) {
      dispatch({
        type: 'error',
        message: e instanceof Error ? e.message : '파일 처리 중 오류가 발생했습니다. 다시 선택해주세요.',
      });
    } finally {
      busy.current = false;
    }
  }, []);

  const handleDrop = useCallback((ev: DragEvent<HTMLElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (state.kind !== 'idle' || busy.current) return;
    const transfer = ev.dataTransfer;
    void run(() => collectFromDataTransfer(transfer, reportCollection));
  }, [run, reportCollection, state.kind]);

  const handleFileInput = useCallback((ev: ChangeEvent<HTMLInputElement>) => {
    const input = ev.currentTarget;
    const files = input.files;
    if (!files?.length || state.kind !== 'idle' || busy.current) return;
    // Collection snapshots File handles synchronously; do not retain them in the input.
    void run(() => collectFromFileList(files, reportCollection));
    input.value = '';
  }, [run, reportCollection, state.kind]);

  const onDragOver = (ev: DragEvent<HTMLElement>) => {
    ev.preventDefault();
    if (state.kind === 'idle') dispatch({ type: 'drag', active: true });
  };
  const onDragLeave = (ev: DragEvent<HTMLElement>) => {
    ev.preventDefault();
    if (ev.relatedTarget instanceof Node && ev.currentTarget.contains(ev.relatedTarget)) return;
    if (state.kind === 'idle') dispatch({ type: 'drag', active: false });
  };
  const reset = () => forgetResult('reset');

  return (
    <div className="app">
      <header>
        <div className="site-nav">
          <a className="site-name" href="https://nfd2nfc.com/">NFD2NFC</a>
          <nav aria-label="주요 메뉴">
            <a href="#how-to-use">사용 방법</a>
            <a href="#cli">CLI</a>
            <a href="https://github.com/jung-geun/NFD2NFC" target="_blank" rel="noopener noreferrer">GitHub ↗</a>
          </nav>
        </div>
        <p className="eyebrow">한글 파일명, 어디서든 바르게</p>
        <h1>NFD → NFC 파일명 변환기</h1>
        <p>
          macOS 한글 파일명의 자소 분리(NFD)를 NFC로 정리하는 무료 도구입니다.
          이 페이지에서 ZIP·파일·폴더를 선택하면 이름을 정리한 ZIP을 바로 받을 수 있습니다.
        </p>
        <p className="tool-intro">설치 없이 웹에서 간단하게, 반복 작업이나 큰 폴더는 CLI를 설치해 로컬에서 실행하세요.</p>
        <p className="privacy-note">
          <svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="4" y="8" width="12" height="9" rx="2" />
            <path d="M7 8V6a3 3 0 0 1 6 0v2M10 11v3" />
          </svg>
          파일 변환은 서버 업로드·브라우저 영구 저장 없이, 이 기기에서 처리합니다.
        </p>
      </header>

      <main>
        <section id="converter" aria-label="파일명 변환">
        {state.kind === 'idle' ? (
          <IdleView
            dragActive={state.dragActive}
            error={state.error}
            notice={state.notice}
            onDrop={handleDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onFileInput={handleFileInput}
            inputRef={fileInput}
            errorRef={errorMessage}
          />
        ) : (
          <>
            <ProcessingPipeline progress={state.progress} collected={state.collected} />
            {state.kind === 'ready' && (
              <ReadyView
                collected={state.collected}
                zipBytes={state.zipBytes}
                downloadUrl={state.downloadUrl}
                filename={state.filename}
                expiresAt={state.expiresAt}
                onDownload={handleDownload}
                headingRef={resultHeading}
                onReset={reset}
              />
            )}
          </>
        )}
        </section>

        <section id="how-to-use" className="guide-section" aria-labelledby="web-guide-title">
          <p className="eyebrow">웹에서 바로 실행</p>
          <h2 id="web-guide-title">설치 없이, 세 단계면 끝납니다.</h2>
          <ol className="web-steps">
            <li>
              <h3>ZIP·파일·폴더 선택</h3>
              <p>위의 선택 버튼을 누르거나 파일과 폴더를 끌어다 놓으세요.</p>
            </li>
            <li>
              <h3>한글 이름 자동 정리</h3>
              <p>선택하면 변환이 바로 시작됩니다. ZIP을 풀고 폴더 구조를 유지해 NFC로 정리합니다.</p>
            </li>
            <li>
              <h3>변환한 ZIP 다운로드</h3>
              <p>완료 후 ZIP 다운로드를 누르세요. 원본은 그대로 두고 새 ZIP을 만듭니다.</p>
            </li>
          </ol>
          <a className="guide-link" href="#converter">파일 선택 영역으로 이동 ↑</a>
        </section>

        <section id="cli" className="guide-section" aria-labelledby="cli-guide-title">
          <p className="eyebrow">CLI로 로컬 실행</p>
          <h2 id="cli-guide-title">반복 작업은 터미널에서.</h2>
          <p>Git·Node.js·npm이 설치된 환경에서 GitHub 소스로 CLI를 설치하면 로컬 파일·폴더의 이름을 직접 정리할 수 있습니다.</p>
          <pre className="cli-commands" aria-label="CLI 설치와 실행 명령"><code>{`git clone https://github.com/jung-geun/NFD2NFC.git
cd NFD2NFC
npm install
npm run build:cli
npm install -g .

# 변경할 이름 먼저 확인 (하위 폴더 포함)
nfd2nfc dir "./my-folder" --recursive --dry-run

# 확인 후 실제 파일명 변경
nfd2nfc dir "./my-folder" --recursive`}</code></pre>
          <p className="guide-note"><code>./my-folder</code>를 원하는 폴더 경로로 바꾸세요. 웹 버전과 달리 CLI는 원본 이름을 변경하므로, 먼저 <code>--dry-run</code>으로 대상을 확인하세요.</p>
          <a className="guide-link" href="https://github.com/jung-geun/NFD2NFC#cli" target="_blank" rel="noopener noreferrer">GitHub에서 소스와 전체 사용법 보기 ↗</a>
        </section>

        <section id="faq" className="guide-section" aria-labelledby="faq-title">
          <h2 id="faq-title">자주 묻는 질문</h2>
          <details>
            <summary>NFD와 NFC는 무엇이 다른가요?</summary>
            <p>NFD는 한글을 자모로 분리해 저장하고, NFC는 가능한 경우 완성형 문자로 합칩니다. 이 도구는 한글 NFD가 포함된 파일·폴더 이름을 정리하며, 문서 내용이나 모든 종류의 인코딩 오류를 고치는 도구는 아닙니다.</p>
          </details>
          <details>
            <summary>원본 파일이나 내용이 바뀌나요?</summary>
            <p>웹 버전은 원본 이름과 내용을 바꾸지 않고 새 ZIP을 만듭니다. CLI는 로컬 원본의 이름을 직접 변경합니다. 두 방식 모두 파일 내용은 변경하지 않습니다.</p>
          </details>
          <details>
            <summary>큰 파일이나 폴더도 변환할 수 있나요?</summary>
            <p>웹 버전은 선택한 파일 합계, ZIP 해제 후 합계, 생성 ZIP을 각각 {PROCESSING_LIMIT_LABEL}로 제한합니다. 더 큰 자료나 반복 작업에는 로컬 CLI 또는 macOS 앱을 이용하세요.</p>
          </details>
          <details>
            <summary>변환한 파일은 어디에 보관되나요?</summary>
            <p>파일은 이 기기에서 처리하며 브라우저 영구 저장소에 보관하지 않습니다. 변환 결과와 다운로드 링크는 {RESULT_LIFETIME_MS / 60_000}분 뒤 자동 해제됩니다. 기기에 다운로드한 파일은 직접 삭제해야 합니다.</p>
          </details>
        </section>
      </main>

      <footer>
        <p>파일 내용은 그대로, 한글 이름만 정리합니다.</p>
        <p>선택·압축 해제 후 파일 합계와 생성 ZIP은 각각 최대 {PROCESSING_LIMIT_LABEL}입니다.</p>
        <p>결과는 {RESULT_LIFETIME_MS / 60_000}분 뒤 자동 해제됩니다. 기기에 다운로드한 파일은 직접 삭제해주세요.</p>
        <details id="privacy" className="privacy-disclosure">
          <summary>개인정보 및 광고 안내</summary>
          <p>변환 코드는 선택한 파일을 서버로 전송하지 않습니다. Google AdSense 광고는 별도로 외부 네트워크 요청을 보내며, Google과 광고 파트너는 쿠키·IP 주소·기기 정보 등을 광고 제공 및 측정에 사용할 수 있습니다.</p>
          <p>광고 스크립트는 페이지와 같은 실행 환경을 공유합니다. 외부 스크립트 없이 민감한 파일을 처리하려면 로컬 CLI를 이용하세요.</p>
          <p>광고 서비스의 데이터 처리는 <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener noreferrer">Google의 파트너 사이트 데이터 사용 안내</a>를 확인하세요.</p>
        </details>
      </footer>
    </div>
  );
}

function allowPaint(): Promise<void> {
  // Yield without adding an artificial processing duration or blocking a background tab.
  const { promise, resolve } = deferred<void>();
  window.setTimeout(resolve, 0);
  return promise;
}

function IdleView(props: {
  dragActive: boolean;
  error?: string;
  notice?: string;
  onDrop: (ev: DragEvent<HTMLElement>) => void;
  onDragOver: (ev: DragEvent<HTMLElement>) => void;
  onDragLeave: (ev: DragEvent<HTMLElement>) => void;
  onFileInput: (ev: ChangeEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  errorRef: RefObject<HTMLDivElement | null>;
}) {
  const [supportsFolderPicker, setSupportsFolderPicker] = useState(false);
  useEffect(() => {
    setSupportsFolderPicker('webkitdirectory' in document.createElement('input'));
  }, []);
  return (
    <>
      <section
        className={'dropzone' + (props.dragActive ? ' active' : '')}
        aria-label="파일 가져오기"
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
      >
        <svg className="upload-graphic" viewBox="0 0 120 96" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 36h29l8 8h39v37a7 7 0 0 1-7 7H29a7 7 0 0 1-7-7z" />
          <path d="M42 35V14h26l12 12v18M67 14v13h13" />
          <path d="M60 71V51m-8 8 8-8 8 8" />
        </svg>
        <h2>
          <span className="desktop-copy">파일이나 ZIP을 여기에 놓아주세요</span>
          <span className="mobile-copy">파일을 선택해 시작하세요</span>
        </h2>
        <p>ZIP은 풀어서, 폴더는 구조 그대로 이름을 정리합니다.</p>
        <div className="picker-actions">
          <label className="picker-button primary">
            ZIP·파일 선택
            <input ref={props.inputRef} id="file-picker" className="sr-only" type="file" multiple onChange={props.onFileInput} />
          </label>
          {supportsFolderPicker && (
            <label className="picker-button secondary">
              폴더 선택
              <input
                id="folder-picker"
                className="sr-only"
                type="file"
                /* @ts-expect-error — webkitdirectory is supported by browsers but absent from React types. */
                webkitdirectory=""
                multiple
                onChange={props.onFileInput}
              />
            </label>
          )}
        </div>
        <p className="hint">여러 파일을 한 번에 선택할 수 있습니다. 원본은 변경하지 않습니다.</p>
        <p className="hint">한 번에 최대 {PROCESSING_LIMIT_LABEL}. ZIP 해제 후 합계·생성 ZIP에도 같은 제한이 적용됩니다.</p>
        <p className="hint">ZIP 파일명은 UTF-8을 우선 사용하며, 구형 한국어 ZIP은 CP949로 읽습니다.</p>
      </section>
      {props.error && <div className="error" role="alert" tabIndex={-1} ref={props.errorRef}>{props.error}</div>}
      {props.notice && <div className="warn" role="status">{props.notice}</div>}
    </>
  );
}

function ReadyView(props: {
  collected: CollectSummary;
  zipBytes?: number;
  downloadUrl?: string;
  filename: string;
  expiresAt: number;
  onDownload: (event: MouseEvent<HTMLAnchorElement>) => void;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onReset: () => void;
}) {
  const { collected, zipBytes, downloadUrl, filename, onReset } = props;
  const hasFiles = collected.files.length > 0;

  return (
    <section className="result status" data-empty={!hasFiles} aria-labelledby="result-title">
      <h2 id="result-title" tabIndex={-1} ref={props.headingRef}>
        {hasFiles ? 'NFC 파일을 다운로드하세요.' : '다른 파일을 선택해주세요.'}
      </h2>
      {hasFiles ? (
        <div className="stats">
          {collected.archiveCount > 0 && <span><strong>{collected.extractedCount.toLocaleString()}</strong>파일 해제</span>}
          <span><strong>{collected.normalizedCount.toLocaleString()}</strong>NFC 변환</span>
          <span><strong>{collected.passthroughCount.toLocaleString()}</strong>변환 제외</span>
        </div>
      ) : (
        <div className="warn">선택한 항목에 파일이 없습니다. 비어 있지 않은 ZIP이나 폴더를 선택해주세요.</div>
      )}
      {hasFiles && collected.normalizedCount === 0 && (
        <div className="success">한글 파일명은 이미 NFC입니다. 이름 충돌 여부까지 확인해 ZIP을 준비했습니다.</div>
      )}
      {collected.collisions.length > 0 && (
        <div className="warn">
          정규화 후 이름이 겹치는 파일 {collected.collisions.length.toLocaleString()}개는 덮어쓰지 않고{' '}
          <code>-2</code>, <code>-3</code> 등의 번호를 붙였습니다.
        </div>
      )}
      {zipBytes !== undefined && downloadUrl && (
        <>
          <div className="download-file">
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <path d="M5 3h10l4 4v14H5zM14 3v5h5M10 3v3m0 3v3m0 3v3" />
            </svg>
            <span>{filename}</span>
            <small>{formatSize(zipBytes)}</small>
          </div>
          <div className="actions">
            <a className="primary" href={downloadUrl} download={filename} onClick={props.onDownload}>
              <svg className="download-icon" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 3v9m-4-4 4 4 4-4M4 13v4h12v-4" />
              </svg>
              ZIP 다운로드
            </a>
            <button className="link" onClick={onReset}>다른 파일 변환하기</button>
          </div>
          <p className="hint">
            결과와 다운로드 링크는 {RESULT_LIFETIME_MS / 60_000}분 뒤 (
            <time dateTime={new Date(props.expiresAt).toISOString()}>{new Date(props.expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
            ) 자동 해제됩니다. 다운로드한 파일은 기기에 남습니다.
          </p>
        </>
      )}
      {!hasFiles && <div className="actions"><button className="primary" onClick={onReset}>다시 선택하기</button></div>}
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
