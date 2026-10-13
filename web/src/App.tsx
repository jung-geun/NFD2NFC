import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type MouseEvent, type RefObject } from 'react';
import { captureDroppedInputs, captureFileInputs } from './lib/collectFiles';
import { ConversionQueue, type ConversionJob, type ConversionUpdate } from './lib/conversionQueue';
import { ProcessingPipeline } from './ProcessingPipeline';
import { PROCESSING_LIMIT_LABEL, RESULT_LIFETIME_MS } from './lib/resourcePolicy';

const jobLabels: Record<ConversionJob['kind'], string> = {
  queued: '대기 중', working: '처리 중', ready: '완료', error: '처리 실패', expired: '보관 시간 만료',
};

export function App() {
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const queue = useRef<ConversionQueue | null>(null);

  const updateJob = useCallback((update: ConversionUpdate) => {
    setJobs((current) => {
      if (update.type === 'remove') return current.filter((job) => job.id !== update.id);
      const index = current.findIndex((job) => job.id === update.job.id);
      if (index === -1) return [...current, update.job];
      const next = [...current];
      next[index] = update.job;
      return next;
    });
  }, []);

  useEffect(() => {
    const controller = new ConversionQueue(updateJob);
    queue.current = controller;
    const checkExpiry = () => controller.checkExpiry();
    const onPageHide = () => {
      controller.clear();
      setDragActive(false);
    };
    document.addEventListener('visibilitychange', checkExpiry);
    window.addEventListener('focus', checkExpiry);
    window.addEventListener('pageshow', checkExpiry);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      queue.current = null;
      document.removeEventListener('visibilitychange', checkExpiry);
      window.removeEventListener('focus', checkExpiry);
      window.removeEventListener('pageshow', checkExpiry);
      window.removeEventListener('pagehide', onPageHide);
      controller.dispose();
    };
  }, [updateJob]);

  const handleDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    // Native drop handles must be captured before the event's data store is protected.
    queue.current?.enqueue(captureDroppedInputs(event.dataTransfer));
  }, []);

  const handleFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    if (!input.files?.length) return;
    const inputs = captureFileInputs(input.files, input.hasAttribute('webkitdirectory'));
    input.value = '';
    queue.current?.enqueue(inputs);
  }, []);

  const onDragOver = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(true);
  };
  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDragActive(false);
  };
  const handleDownload = (id: number, event: MouseEvent<HTMLAnchorElement>) => {
    if (!queue.current?.canDownload(id)) event.preventDefault();
  };
  const removeJob = (id: number) => {
    queue.current?.remove(id);
    fileInput.current?.focus();
  };

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
          <PickerView
            dragActive={dragActive}
            hasJobs={jobs.length > 0}
            onDrop={handleDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onFileInput={handleFileInput}
            inputRef={fileInput}
          />
          {jobs.length > 0 && (
            <section className="conversion-history" aria-labelledby="jobs-title">
              <h2 id="jobs-title">변환 내역</h2>
              <p className="hint">파일을 계속 추가할 수 있습니다. 완료된 항목은 각각 다운로드하세요.</p>
              <ol className="job-list">
                {jobs.map((job) => (
                  <li className="conversion-job status" data-job-id={job.id} data-kind={job.kind} key={job.id} aria-labelledby={`job-title-${job.id}`}>
                    <div className="job-heading">
                      <div>
                        <p className="eyebrow">변환 {job.id} · {jobLabels[job.kind]}</p>
                        <h3 id={`job-title-${job.id}`}>{job.name}</h3>
                      </div>
                      {job.kind !== 'queued' && job.kind !== 'working' && (
                        <button className="link" aria-label={`${job.name} 결과 삭제`} onClick={() => removeJob(job.id)}>결과 삭제</button>
                      )}
                    </div>
                    {job.kind === 'queued' && <p className="hint" role="status">앞선 항목의 변환이 끝나면 자동으로 시작합니다.</p>}
                    {job.kind === 'working' && <ProcessingPipeline progress={job.progress} collected={job.collected} />}
                    {job.kind === 'ready' && <ReadyView job={job} onDownload={(event) => handleDownload(job.id, event)} />}
                    {job.kind === 'error' && <p className="error" role="alert">{job.message}</p>}
                    {job.kind === 'expired' && <p className="hint" role="status">이 결과의 {RESULT_LIFETIME_MS / 60_000}분 보관 시간이 지나 다운로드 링크를 해제했습니다. 필요하면 파일을 다시 추가하세요.</p>}
                  </li>
                ))}
              </ol>
            </section>
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
              <p>각 항목을 추가한 순서대로 NFC로 정리합니다. 처리 중에도 파일을 계속 추가할 수 있습니다.</p>
            </li>
            <li>
              <h3>변환한 ZIP 다운로드</h3>
              <p>완료된 항목마다 ZIP 다운로드를 누르세요. 파일·ZIP은 각각, 폴더는 구조를 유지한 ZIP 하나로 받을 수 있습니다.</p>
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
            <p>웹 버전은 각 변환 항목의 선택 파일 합계, ZIP 해제 후 합계, 생성 ZIP을 각각 {PROCESSING_LIMIT_LABEL}로 제한합니다. 한 폴더 안의 파일·ZIP은 합산합니다. 더 큰 자료나 반복 작업에는 로컬 CLI 또는 macOS 앱을 이용하세요.</p>
          </details>
          <details>
            <summary>변환한 파일은 어디에 보관되나요?</summary>
            <p>파일은 이 기기에서 처리하며 브라우저 영구 저장소에 보관하지 않습니다. 각 결과와 다운로드 링크는 생성된 뒤 {RESULT_LIFETIME_MS / 60_000}분 후 독립적으로 해제됩니다. 파일을 더 추가해도 기존 결과의 보관 시간은 늘어나지 않습니다. 기기에 다운로드한 파일은 직접 삭제해야 합니다.</p>
          </details>
        </section>
      </main>

      <footer>
        <p>파일 내용은 그대로, 한글 이름만 정리합니다.</p>
        <p>각 변환 항목의 선택·압축 해제 후 파일 합계와 생성 ZIP은 각각 최대 {PROCESSING_LIMIT_LABEL}입니다.</p>
        <p>각 결과는 생성된 뒤 {RESULT_LIFETIME_MS / 60_000}분 후 자동 해제됩니다. 기기에 다운로드한 파일은 직접 삭제해주세요.</p>
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


function PickerView(props: {
  dragActive: boolean;
  hasJobs: boolean;
  onDrop: (ev: DragEvent<HTMLElement>) => void;
  onDragOver: (ev: DragEvent<HTMLElement>) => void;
  onDragLeave: (ev: DragEvent<HTMLElement>) => void;
  onFileInput: (ev: ChangeEvent<HTMLInputElement>) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [supportsFolderPicker, setSupportsFolderPicker] = useState(false);
  useEffect(() => {
    setSupportsFolderPicker('webkitdirectory' in document.createElement('input'));
  }, []);
  return (
      <section
        className={'dropzone' + (props.dragActive ? ' active' : '') + (props.hasJobs ? ' compact' : '')}
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
          <span className="desktop-copy">{props.hasJobs ? '파일이나 ZIP을 계속 추가하세요' : '파일이나 ZIP을 여기에 놓아주세요'}</span>
          <span className="mobile-copy">{props.hasJobs ? '파일을 더 선택하세요' : '파일을 선택해 시작하세요'}</span>
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
        <p className="hint">파일·ZIP은 각각 다운로드하고, 폴더는 ZIP 하나로 묶습니다. 원본은 변경하지 않습니다.</p>
        <p className="hint">각 변환은 최대 {PROCESSING_LIMIT_LABEL}. ZIP 해제 후 합계·생성 ZIP에도 같은 제한이 적용됩니다.</p>
        <p className="hint">ZIP 파일명은 UTF-8을 우선 사용하며, 구형 한국어 ZIP은 CP949로 읽습니다.</p>
      </section>
  );
}

function ReadyView(props: {
  job: Extract<ConversionJob, { kind: 'ready' }>;
  onDownload: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { id, name, collected, zipBytes, downloadUrl, filename, expiresAt } = props.job;
  const hasFiles = collected.files.length > 0;

  return (
    <section className="result" data-empty={!hasFiles} aria-labelledby={`result-title-${id}`}>
      <h4 id={`result-title-${id}`}>
        {hasFiles ? 'NFC 파일을 다운로드하세요.' : '처리할 파일이 없습니다.'}
      </h4>
      <span className="sr-only" role="status">{name} 변환이 완료되었습니다.</span>
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
          </div>
          <p className="hint">
            결과와 다운로드 링크는 {RESULT_LIFETIME_MS / 60_000}분 뒤 (
            <time dateTime={new Date(expiresAt).toISOString()}>{new Date(expiresAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time>
            ) 자동 해제됩니다. 다운로드한 파일은 기기에 남습니다.
          </p>
        </>
      )}
    </section>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
