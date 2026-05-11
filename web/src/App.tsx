import { useCallback, useReducer, type DragEvent } from 'react';
import {
  collectFromDataTransfer,
  collectFromFileList,
  supportsDirectoryDrop,
  type CollectResult,
} from './lib/collectFiles';
import { buildZip, downloadBlob, type BuildProgress } from './lib/buildZip';

type State =
  | { kind: 'idle'; dragActive: boolean; error?: string }
  | { kind: 'reading' }
  | {
      kind: 'processing';
      collected: CollectResult;
      progress: BuildProgress;
    }
  | {
      kind: 'ready';
      collected: CollectResult;
      blob?: Blob;
      filename: string;
    };

type Action =
  | { type: 'drag'; active: boolean }
  | { type: 'reading' }
  | { type: 'error'; message: string }
  | { type: 'processing-start'; collected: CollectResult }
  | { type: 'progress'; progress: BuildProgress }
  | { type: 'ready'; collected: CollectResult; blob: Blob; filename: string }
  | { type: 'ready-empty'; collected: CollectResult; filename: string }
  | { type: 'reset' };

const initial: State = { kind: 'idle', dragActive: false };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'drag':
      if (state.kind !== 'idle') return state;
      return { ...state, dragActive: action.active };
    case 'reading':
      return { kind: 'reading' };
    case 'error':
      return { kind: 'idle', dragActive: false, error: action.message };
    case 'processing-start':
      return {
        kind: 'processing',
        collected: action.collected,
        progress: { done: 0, total: action.collected.files.length },
      };
    case 'progress':
      if (state.kind !== 'processing') return state;
      return { ...state, progress: action.progress };
    case 'ready':
      return {
        kind: 'ready',
        collected: action.collected,
        blob: action.blob,
        filename: action.filename,
      };
    case 'ready-empty':
      return {
        kind: 'ready',
        collected: action.collected,
        filename: action.filename,
      };
    case 'reset':
      return initial;
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

  const process = useCallback(async (collected: CollectResult) => {
    const filename = `nfc-${timestamp()}.zip`;
    if (collected.files.length === 0) {
      dispatch({ type: 'ready-empty', collected, filename });
      return;
    }
    dispatch({ type: 'processing-start', collected });
    try {
      const blob = await buildZip(collected.files, (progress) =>
        dispatch({ type: 'progress', progress }),
      );
      dispatch({ type: 'ready', collected, blob, filename });
    } catch (e) {
      dispatch({
        type: 'error',
        message: e instanceof Error ? e.message : 'ZIP 생성 중 알 수 없는 오류가 발생했습니다.',
      });
    }
  }, []);

  const handleDrop = useCallback(
    async (ev: DragEvent<HTMLLabelElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (state.kind !== 'idle') return;

      if (!supportsDirectoryDrop(ev.dataTransfer.items)) {
        dispatch({
          type: 'error',
          message:
            '이 브라우저는 폴더 드롭을 완전히 지원하지 않습니다. 최신 Chrome / Edge / Safari 16.4+ 를 사용해주세요.',
        });
        return;
      }

      dispatch({ type: 'reading' });
      try {
        const collected = await collectFromDataTransfer(ev.dataTransfer);
        await process(collected);
      } catch (e) {
        dispatch({
          type: 'error',
          message: e instanceof Error ? e.message : '파일을 읽는 중 오류가 발생했습니다.',
        });
      }
    },
    [process, state.kind],
  );

  const handleFileInput = useCallback(
    async (ev: React.ChangeEvent<HTMLInputElement>) => {
      const fl = ev.target.files;
      if (!fl || fl.length === 0) return;
      dispatch({ type: 'reading' });
      try {
        const collected = collectFromFileList(fl);
        await process(collected);
      } catch (e) {
        dispatch({
          type: 'error',
          message: e instanceof Error ? e.message : '파일을 읽는 중 오류가 발생했습니다.',
        });
      } finally {
        // 같은 파일을 다시 선택할 수 있게 input 초기화.
        ev.target.value = '';
      }
    },
    [process],
  );

  const onDragOver = (ev: DragEvent<HTMLLabelElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (state.kind === 'idle') dispatch({ type: 'drag', active: true });
  };
  const onDragLeave = (ev: DragEvent<HTMLLabelElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (state.kind === 'idle') dispatch({ type: 'drag', active: false });
  };

  return (
    <div className="app">
      <header>
        <h1>NFD → NFC 파일명 변환기</h1>
        <p>
          macOS 에서 만들어진 ZIP 이나 폴더의 한글 파일명이 Windows / Linux 에서 깨져 보이는 문제를
          해결합니다. 파일이나 폴더를 아래 영역에 끌어다 놓으면 NFC 로 정규화된 ZIP 을 다운로드할 수
          있습니다. 업로드되는 파일은 서버로 전송되지 않고 브라우저 안에서만 처리됩니다.
        </p>
      </header>

      <main>
        {state.kind === 'idle' && (
          <IdleView
            dragActive={state.dragActive}
            error={state.error}
            onDrop={handleDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onFileInput={handleFileInput}
          />
        )}
        {state.kind === 'reading' && <ReadingView />}
        {state.kind === 'processing' && (
          <ProcessingView collected={state.collected} progress={state.progress} />
        )}
        {state.kind === 'ready' && (
          <ReadyView
            collected={state.collected}
            blob={state.blob}
            filename={state.filename}
            onReset={() => dispatch({ type: 'reset' })}
          />
        )}
      </main>

      <footer>
        <p>
          모든 변환은 브라우저에서 로컬로 수행됩니다. 큰 폴더(약 2GB 이상)는 메모리 한계로 실패할
          수 있습니다.
        </p>
      </footer>
    </div>
  );
}

function IdleView(props: {
  dragActive: boolean;
  error?: string;
  onDrop: (ev: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (ev: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: (ev: DragEvent<HTMLLabelElement>) => void;
  onFileInput: (ev: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      <label
        className={'dropzone' + (props.dragActive ? ' active' : '')}
        onDrop={props.onDrop}
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
      >
        <h2>여기에 파일이나 폴더를 끌어다 놓으세요</h2>
        <p>
          또는 클릭하여 폴더를 선택할 수 있습니다.
          <br />
          드롭한 파일은 NFC 이름으로 정규화되어 하나의 ZIP 으로 묶입니다.
        </p>
        <p className="hint">한글이 없는 파일은 이름을 그대로 유지합니다.</p>
        <input
          type="file"
          /* @ts-expect-error — webkitdirectory 는 React 타입 정의가 누락된 비표준 속성. */
          webkitdirectory=""
          directory=""
          multiple
          onChange={props.onFileInput}
        />
      </label>
      {props.error && <div className="error">{props.error}</div>}
    </>
  );
}

function ReadingView() {
  return (
    <div className="status">
      <h2>파일 목록을 읽는 중…</h2>
      <p className="progress-label">큰 폴더는 시간이 걸릴 수 있습니다.</p>
    </div>
  );
}

function ProcessingView(props: {
  collected: CollectResult;
  progress: BuildProgress;
}) {
  const pct =
    props.progress.total === 0 ? 0 : Math.round((props.progress.done / props.progress.total) * 100);
  return (
    <div className="status">
      <h2>ZIP 으로 묶는 중…</h2>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-label">
        {props.progress.done.toLocaleString()} / {props.progress.total.toLocaleString()} 파일
        {' · '}
        {pct}%
      </div>
      <div className="stats">
        <span>
          <strong>{props.collected.normalizedCount.toLocaleString()}</strong>변환 대상
        </span>
        <span>
          <strong>{props.collected.passthroughCount.toLocaleString()}</strong>그대로 유지
        </span>
      </div>
    </div>
  );
}

function ReadyView(props: {
  collected: CollectResult;
  blob?: Blob;
  filename: string;
  onReset: () => void;
}) {
  const { collected, blob, filename, onReset } = props;
  const hasFiles = collected.files.length > 0;
  const hasNormalizable = collected.normalizedCount > 0;

  return (
    <div className="status">
      <h2>
        {hasNormalizable ? '완료되었습니다.' : '변환할 파일이 없습니다.'}
      </h2>
      <div className="stats">
        <span>
          <strong>{collected.normalizedCount.toLocaleString()}</strong>이름 변경
        </span>
        <span>
          <strong>{collected.passthroughCount.toLocaleString()}</strong>그대로 유지
        </span>
      </div>

      {!hasFiles && (
        <div className="warn">
          드롭한 항목에서 처리할 파일을 찾지 못했습니다. 폴더가 비어있거나 형식이 지원되지 않을 수
          있습니다.
        </div>
      )}

      {hasFiles && !hasNormalizable && (
        <div className="success">
          모든 파일명이 이미 NFC 입니다. 별도의 변환이 필요하지 않습니다.
        </div>
      )}

      {collected.collisions.length > 0 && (
        <div className="warn">
          정규화 후 같은 이름이 된 파일 {collected.collisions.length} 개를 자동으로 <code>-2</code>,
          <code>-3</code> ... 형태로 이름을 변경했습니다.
        </div>
      )}

      <div className="actions">
        {blob && hasFiles && (
          <button className="primary" onClick={() => downloadBlob(blob, filename)}>
            ZIP 다운로드 ({formatSize(blob.size)})
          </button>
        )}
        <button className="link" onClick={onReset}>
          다시 시작
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
