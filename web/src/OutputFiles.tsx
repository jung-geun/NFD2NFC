import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { ConversionJob } from './lib/conversionQueue';
import { RESULT_LIFETIME_MS } from './lib/resourcePolicy';
import { ProcessingPipeline } from './ProcessingPipeline';

type OutputFilesProps = {
  jobs: ConversionJob[];
  onDownload: (id: number, event: MouseEvent<HTMLAnchorElement>) => void;
  onRemove: (id: number) => void;
  onCheckExpiry: () => void;
};

const jobLabels: Record<ConversionJob['kind'], string> = {
  queued: '대기 중',
  working: '처리 중',
  ready: '다운로드 가능',
  error: '처리 실패',
  expired: '만료',
};

const REMOVAL_DURATION_MS = 900;
const removalStyle = { '--dust-duration': `${REMOVAL_DURATION_MS}ms` } as CSSProperties;
const dustMotes = Array.from(
  { length: 48 },
  (_, index) =>
    ({
      '--dust-x': `${6 + (index * 88) / 47}%`,
      '--dust-y': `${18 + ((index * 29) % 66)}%`,
      '--dust-dx': `${18 + ((index * 17) % 48)}px`,
      '--dust-dy': `${-12 - ((index * 13) % 38)}px`,
      '--dust-size': `${1.5 + (index % 4) * 0.5}px`,
      '--dust-delay': `${index * 5}ms`,
    }) as CSSProperties
);

export function OutputFiles({ jobs, onDownload, onRemove, onCheckExpiry }: OutputFilesProps) {
  const [now, setNow] = useState(Date.now);
  const nextExpiry = jobs.reduce(
    (nearest, job) => (job.kind === 'ready' ? Math.min(nearest, job.expiresAt) : nearest),
    Infinity
  );

  useEffect(() => {
    if (nextExpiry === Infinity) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearInterval(timer);
      timer = undefined;
      const tick = () => {
        const timestamp = Date.now();
        setNow(timestamp);
        if (timestamp >= nextExpiry) onCheckExpiry();
      };
      tick();
      if (!document.hidden) timer = window.setInterval(tick, 1_000);
    };
    refresh();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [nextExpiry, onCheckExpiry]);

  return (
    <section className="conversion-history" aria-labelledby="jobs-title">
      <h2 id="jobs-title">출력 파일</h2>
      <p className="hint">
        압축 파일명을 클릭해 다운로드하세요. {RESULT_LIFETIME_MS / 60_000}분 뒤 만료되며 목록에서 자동으로 사라집니다.
      </p>
      <ul className="job-list">
        {jobs.map((job) => (
          <OutputFile key={job.id} job={job} now={now} onDownload={onDownload} onRemove={onRemove} />
        ))}
      </ul>
    </section>
  );
}

function OutputFile({
  job,
  now,
  onDownload,
  onRemove,
}: {
  job: ConversionJob;
  now: number;
  onDownload: OutputFilesProps['onDownload'];
  onRemove: OutputFilesProps['onRemove'];
}) {
  const [removing, setRemoving] = useState(false);
  const row = useRef<HTMLLIElement>(null);
  const focused = useRef(false);
  const leaving = removing || job.kind === 'expired';
  const downloadable = job.kind === 'ready' && job.downloadUrl !== undefined && now < job.expiresAt && !leaving;
  const remaining =
    job.kind === 'ready'
      ? Math.max(0, Math.min(RESULT_LIFETIME_MS / 1_000, Math.ceil((job.expiresAt - now) / 1_000)))
      : 0;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const labelId = `job-title-${job.id}`;

  useEffect(() => {
    if (!leaving) return;
    if (focused.current || row.current?.contains(document.activeElement)) {
      const next = row.current?.nextElementSibling?.querySelector<HTMLElement>(
        '.output-link, .job-remove:not(:disabled)'
      );
      const previous = row.current?.previousElementSibling?.querySelector<HTMLElement>(
        '.output-link, .job-remove:not(:disabled)'
      );
      (next ?? previous ?? document.getElementById('file-picker'))?.focus({ preventScroll: true });
      focused.current = false;
    }
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finish = () => onRemove(job.id);
    if (motion.matches || document.hidden) {
      finish();
      return;
    }
    // Cleanup must not depend on an animation event, especially after a tab is suspended.
    const timer = window.setTimeout(finish, REMOVAL_DURATION_MS + 100);
    const skipAnimation = () => {
      if (motion.matches || document.hidden) finish();
    };
    motion.addEventListener('change', skipAnimation);
    document.addEventListener('visibilitychange', skipAnimation);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener('change', skipAnimation);
      document.removeEventListener('visibilitychange', skipAnimation);
    };
  }, [leaving, job.id, onRemove]);

  return (
    <li
      ref={row}
      className="conversion-job"
      data-job-id={job.id}
      data-kind={job.kind}
      data-leaving={leaving}
      style={removalStyle}
      aria-labelledby={labelId}
      onFocusCapture={() => {
        focused.current = true;
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focused.current = false;
      }}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget && event.animationName === 'output-collapse')
          onRemove(job.id);
      }}
    >
      <div className="job-clip">
        <div className="job-row">
          <div className="job-file">
            <svg
              className="output-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            >
              <path d="M5 3h10l4 4v14H5zM14 3v5h5M10 3v3m0 3v3m0 3v3" />
            </svg>
            <div className="job-description">
              {downloadable ? (
                <a
                  id={labelId}
                  className="output-name output-link"
                  href={job.downloadUrl}
                  download={job.filename}
                  onClick={(event) => onDownload(job.id, event)}
                >
                  {job.filename}
                </a>
              ) : (
                <span id={labelId} className="output-name">
                  {job.filename}
                </span>
              )}
              {job.kind === 'ready' &&
                (job.downloadUrl ? (
                  <p className="job-meta">
                    {job.collected.files.length.toLocaleString()}개 파일 ·{' '}
                    {job.collected.normalizedCount > 0
                      ? `${job.collected.normalizedCount.toLocaleString()}개 이름 정리`
                      : '이름 유지'}
                  </p>
                ) : (
                  <p className="job-meta">선택한 항목에 파일이 없습니다. 비어 있지 않은 ZIP이나 폴더를 추가하세요.</p>
                ))}
              {job.kind === 'ready' && job.collected.collisions.length > 0 && (
                <p className="job-meta job-warning">
                  이름이 겹치는 {job.collected.collisions.length.toLocaleString()}개 파일에 번호를 붙여 보존했습니다.
                </p>
              )}
              {job.kind === 'queued' && <p className="job-meta">앞선 항목의 변환이 끝나면 시작합니다.</p>}
              {job.kind === 'error' && (
                <p className="job-meta job-error" role="alert">
                  {job.message}
                </p>
              )}
              {job.kind === 'expired' && <p className="job-meta">보관 시간이 지나 목록에서 제거합니다.</p>}
            </div>
          </div>
          <div className="job-info">
            {job.kind === 'ready' && job.zipBytes !== undefined && (
              <span className="job-size">{formatSize(job.zipBytes)}</span>
            )}
            {downloadable ? (
              <time
                className="job-countdown"
                role="timer"
                aria-live="off"
                data-urgent={remaining <= 30}
                dateTime={new Date(job.expiresAt).toISOString()}
                aria-label={`${minutes}분 ${seconds}초 뒤 다운로드 만료`}
              >
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 4v4l2.5 1.5" />
                </svg>
                {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')} 남음
              </time>
            ) : (
              <span className="job-state" role="status">
                {leaving
                  ? '제거 중'
                  : job.kind === 'ready'
                    ? job.downloadUrl
                      ? '만료'
                      : '파일 없음'
                    : jobLabels[job.kind]}
              </span>
            )}
          </div>
          {job.kind !== 'queued' && job.kind !== 'working' && (
            <button
              className="job-remove"
              aria-label={`${job.filename} 결과 삭제`}
              title="목록에서 삭제"
              disabled={leaving}
              onClick={() => setRemoving(true)}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="m6 6 8 8M14 6l-8 8" />
              </svg>
            </button>
          )}
          {job.kind === 'working' && (
            <details className="job-progress">
              <summary>처리 과정 보기</summary>
              <ProcessingPipeline progress={job.progress} collected={job.collected} />
            </details>
          )}
          {leaving && (
            <span className="job-dust" aria-hidden="true">
              {dustMotes.map((style, index) => (
                <span key={index} className="dust-mote" style={style} />
              ))}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
