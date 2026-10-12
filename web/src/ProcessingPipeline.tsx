import { useMemo } from 'react';
import type { CollectProgress, CollectSummary } from './lib/collectFiles';

export interface WorkflowProgress {
  phase: CollectProgress['phase'] | 'compressing' | 'linking' | 'ready' | 'empty';
  done: number;
  total?: number;
  currentPath?: string;
  archiveCount: number;
  bytesDone?: number;
  bytesTotal?: number;
}

const phaseCopy: Record<WorkflowProgress['phase'], { title: string; description: string }> = {
  reading: {
    title: '파일을 불러오고 있어요',
    description: '선택한 파일과 폴더의 목록을 확인합니다.',
  },
  extracting: {
    title: 'ZIP 속 파일을 꺼내고 있어요',
    description: '압축을 풀어 내부 파일과 폴더 구조를 확인합니다.',
  },
  analyzing: {
    title: '한글 파일명을 분석하고 있어요',
    description: '분리된 한글 자모를 NFC로 모으고, 겹치는 이름을 정리합니다.',
  },
  compressing: {
    title: '파일을 ZIP으로 묶고 있어요',
    description: '파일 내용은 바꾸지 않고, 정리된 이름으로 ZIP을 만듭니다.',
  },
  linking: {
    title: '다운로드 링크를 만들고 있어요',
    description: '완성된 ZIP을 이 브라우저에서 바로 받을 수 있도록 준비합니다.',
  },
  ready: {
    title: '파일 준비가 끝났어요',
    description: '이름 분석부터 다운로드 준비까지, 모든 처리가 완료되었습니다.',
  },
  empty: {
    title: '처리할 파일이 없어요',
    description: '파일을 찾지 못해 ZIP 생성과 링크 생성을 건너뛰었습니다.',
  },
};

const phaseIndex: Record<WorkflowProgress['phase'], number> = {
  reading: 0,
  extracting: 0,
  analyzing: 1,
  compressing: 2,
  linking: 3,
  ready: 4,
  empty: 2,
};

export function ProcessingPipeline({ progress, collected }: {
  progress: WorkflowProgress;
  collected?: CollectSummary;
}) {
  const { phase } = progress;
  const copy = phaseCopy[phase];
  const complete = phase === 'ready' || phase === 'empty';
  const currentIndex = phaseIndex[phase];
  const changedFile = useMemo(() => collected?.files.find((file) => file.normalized), [collected]);
  const usesBytes = phase === 'compressing' && (progress.bytesTotal ?? 0) > 0;
  const total = usesBytes ? progress.bytesTotal : progress.total;
  const done = usesBytes ? progress.bytesDone ?? 0 : progress.done;
  const fraction = total === undefined || total === 0 ? undefined : Math.min(1, Math.max(0, done / total));
  const percent = fraction === undefined ? undefined : Math.floor(fraction * 100);
  const steps = [
    {
      title: progress.archiveCount > 0 ? 'ZIP 해제' : '파일 읽기',
      detail: progress.archiveCount > 0
        ? `${progress.archiveCount.toLocaleString()}개 ZIP 확인`
        : 'ZIP이 없으면 해제 생략',
    },
    {
      title: '이름 분석',
      detail: collected ? `${collected.normalizedCount.toLocaleString()}개 이름 정리` : 'NFD → NFC 정규화',
    },
    {
      title: 'ZIP 압축',
      detail: collected ? `${collected.files.length.toLocaleString()}개 파일 묶기` : '폴더 구조 그대로',
    },
    { title: '링크 생성', detail: phase === 'ready' ? '다운로드 준비 완료' : '내 기기에서 다운로드' },
  ];

  let counter: string;
  if (phase === 'linking') counter = '로컬 링크 준비 중';
  else if (phase === 'extracting') counter = `${progress.done.toLocaleString()} / ${(progress.total ?? progress.archiveCount).toLocaleString()} ZIP`;
  else if (usesBytes) counter = `${formatBytes(done)} / ${formatBytes(total ?? 0)} · ${progress.done.toLocaleString()} / ${(progress.total ?? 0).toLocaleString()} 파일`;
  else if (progress.total !== undefined) counter = `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} 파일`;
  else counter = `${progress.done.toLocaleString()}개 파일 발견`;

  return (
    <section className="pipeline" data-phase={phase} aria-labelledby="workflow-title">
      <div className="pipeline-heading">
        <p className="eyebrow">{complete ? '처리 결과' : '내 기기에서 처리 중'}</p>
        <h2 id="workflow-title">{copy.title}</h2>
        <p>{copy.description}</p>
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copy.title}</span>
      <div className="motion-stage" data-phase={phase} data-has-archives={progress.archiveCount > 0} aria-hidden="true">
        <PipelineGraphic />
      </div>
      <div className="pipeline-steps">
      <ol aria-label="파일 처리 단계">
        {steps.map((step, index) => {
          const status = phase === 'empty' && index >= 2
            ? 'skipped'
            : index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
          const statusLabel = { done: '완료', active: '진행 중', pending: '대기', skipped: '생략' }[status];
          return (
            <li className="pipeline-step" data-state={status} key={index} aria-current={status === 'active' ? 'step' : undefined}>
              <StepIcon index={index} done={status === 'done'} />
              <div className="step-copy"><strong>{step.title}</strong><small>{step.detail}</small></div>
              <span className="step-state">{statusLabel}</span>
            </li>
          );
        })}
      </ol>
      </div>
      {!complete && (
        <div className="processing-detail">
          <div className="detail-row">
            <span>{counter}</span>
            {percent !== undefined && <strong>{percent}%</strong>}
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={`${steps[currentIndex].title} 진행률`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={fraction === undefined ? counter : `${counter}, ${percent}%`}
          >
            <div key={phase} className={'progress-fill' + (fraction === undefined ? ' indeterminate' : '')} style={fraction === undefined ? undefined : { transform: `scaleX(${fraction})` }} />
          </div>
          {progress.currentPath && <p className="current-file" title={progress.currentPath}>{progress.currentPath}</p>}
        </div>
      )}
      {changedFile && (
        <div className="normalization-preview">
          <small>실제 파일명 정리 · NFD에서 NFC로</small>
          <div className="name-pair">
            <code title={changedFile.originalPath}>{changedFile.originalPath}</code>
            <span aria-hidden="true">→</span>
            <code title={changedFile.zipPath}>{changedFile.zipPath}</code>
          </div>
        </div>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function PipelineGraphic() {
  return (
    <svg className="pipeline-graphic" viewBox="0 0 480 180" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g className="motion-orbit" strokeDasharray="3 7">
        <circle cx="240" cy="94" r="72" />
      </g>
      <g className="motion-archive">
        <rect x="53" y="49" width="78" height="90" rx="12" />
        <path d="M92 49v14m0 6v7m0 6v7" fill="none" />
        <rect x="87" y="89" width="10" height="13" rx="2" />
        <text x="92" y="122" textAnchor="middle" fill="currentColor" stroke="none" fontSize="13" fontWeight="650">ZIP</text>
      </g>
      <g className="motion-file motion-file-1">
        <path d="M157 62h29l12 12v61h-41z" />
        <path d="M186 62v13h12M166 91h23m-23 10h17m-17 10h21" fill="none" />
      </g>
      <g className="motion-file motion-file-2">
        <path d="M219 41h29l12 12v61h-41z" />
        <path d="M248 41v13h12M228 70h23m-23 10h17m-17 10h21" fill="none" />
      </g>
      <g className="motion-file motion-file-3">
        <path d="M281 62h29l12 12v61h-41z" />
        <path d="M310 62v13h12M290 91h23m-23 10h17m-17 10h21" fill="none" />
      </g>
      <g className="motion-glyphs">
        <rect x="142" y="29" width="196" height="122" rx="14" />
        <text x="240" y="65" textAnchor="middle" fill="currentColor" stroke="none" fontSize="19">ᄒ ᅡ ᆫ ᄀ ᅳ ᆯ</text>
        <path d="M240 80v19m-6-6 6 6 6-6" fill="none" />
        <text x="240" y="130" textAnchor="middle" fill="currentColor" stroke="none" fontSize="23" fontWeight="650">한글.txt</text>
      </g>
      <g className="motion-scan">
        <path d="M151 86h178" strokeWidth="3" />
        <path d="M145 48v-9h9m172 0h9v9M145 132v9h9m172 0h9v-9" />
      </g>
      <g className="motion-packed">
        <rect x="207" y="44" width="66" height="91" rx="12" />
        <path d="M240 44v14m0 6v6m0 6v6" fill="none" />
        <rect x="235" y="83" width="10" height="13" rx="2" />
        <text x="240" y="119" textAnchor="middle" fill="currentColor" stroke="none" fontSize="13" fontWeight="650">NFC</text>
      </g>
      <g className="motion-link">
        <path d="M290 93h34" strokeDasharray="3 5" />
        <path d="m348 82 7-7a10 10 0 0 1 14 14l-7 7m-7 0-7 7a10 10 0 0 1-14-14l7-7m3 11 15-15" strokeWidth="2.5" fill="none" />
      </g>
      <g className="motion-check">
        <circle cx="404" cy="93" r="17" />
        <path d="m397 93 5 5 9-10" strokeWidth="2.5" fill="none" />
      </g>
    </svg>
  );
}

function StepIcon({ index, done }: { index: number; done: boolean }) {
  return (
    <svg className="step-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {done ? <path d="m5 12 4 4L19 6" /> : index === 0 ? (
        <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M12 3v4m0 3v3m-2 3h4" /></>
      ) : index === 1 ? (
        <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10" /><path d="M8 8h8m-8 8h8" /></>
      ) : index === 2 ? (
        <><path d="m3 7 9-4 9 4-9 4zM3 7v11l9 4 9-4V7M12 11v11" /></>
      ) : (
        <path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3m-3 3-3 3a5 5 0 0 1-7-7l3-3m2 5 6-6" />
      )}
    </svg>
  );
}
