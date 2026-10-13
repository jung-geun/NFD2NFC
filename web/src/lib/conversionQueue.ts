import type { WorkflowProgress } from '../ProcessingPipeline';
import { buildZip } from './buildZip';
import type { CollectSummary, ConversionInput } from './collectFiles';
import { deferred } from './deferred';
import { normalizeToNFC, shouldNormalize } from './normalize';
import { RESULT_LIFETIME_MS } from './resourcePolicy';

type JobIdentity = { id: number; name: string; filename: string };
export type ConversionJob = JobIdentity & (
  | { kind: 'queued' }
  | { kind: 'working'; progress: WorkflowProgress; collected?: CollectSummary }
  | {
      kind: 'ready';
      collected: CollectSummary;
      zipBytes?: number;
      downloadUrl?: string;
      expiresAt: number;
    }
  | { kind: 'error'; message: string }
  | { kind: 'expired' }
);

export type ConversionUpdate = { type: 'job'; job: ConversionJob } | { type: 'remove'; id: number };

type Request = JobIdentity & { input: ConversionInput };
type ActiveJob = JobIdentity;

function allowPaint(): Promise<void> {
  const { promise, resolve } = deferred<void>();
  setTimeout(resolve, 0);
  return promise;
}

export class ConversionQueue {
  private nextId = 1;
  private jobs = new Map<number, ConversionJob>();
  private pending: Request[] = [];
  private active: ActiveJob | undefined;
  private disposed = false;
  private expiryTimer: number | undefined;
  private delayedRevocations = new Map<string, number>();

  constructor(private readonly onUpdate: (update: ConversionUpdate) => void) {}

  enqueue(inputs: readonly ConversionInput[]): void {
    if (this.disposed) return;
    for (const input of inputs) {
      if (this.disposed) break;
      const name = shouldNormalize(input.name) ? normalizeToNFC(input.name) : input.name;
      const filename = `${input.isDirectory ? name : name.replace(/\.zip$/i, '')}.zip`;
      const identity = { id: this.nextId++, name: input.name, filename };
      this.pending.push({ ...identity, input });
      this.publish({ ...identity, kind: 'queued' });
    }
    this.startNext();
  }

  remove(id: number): void {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    this.pending = this.pending.filter((request) => request.id !== id);
    if (job.kind === 'ready' && job.downloadUrl) {
      // Safari may still be consuming the URL after the user clicks Download then Remove.
      const url = job.downloadUrl;
      const timer = window.setTimeout(() => {
        this.delayedRevocations.delete(url);
        URL.revokeObjectURL(url);
      }, 1_000);
      this.delayedRevocations.set(url, timer);
    }
    this.scheduleExpiry();
    this.onUpdate({ type: 'remove', id });
  }

  checkExpiry(): void {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.kind !== 'ready' || now < job.expiresAt) continue;
      if (job.downloadUrl) URL.revokeObjectURL(job.downloadUrl);
      this.publish({ id: job.id, name: job.name, filename: job.filename, kind: 'expired' });
    }
    this.scheduleExpiry();
  }

  canDownload(id: number): boolean {
    this.checkExpiry();
    const job = this.jobs.get(id);
    return job?.kind === 'ready' && job.downloadUrl !== undefined;
  }

  clear(): void {
    this.active = undefined;
    this.pending = [];
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    for (const [url, timer] of this.delayedRevocations) {
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.delayedRevocations.clear();
    const jobs = this.jobs;
    this.jobs = new Map();
    for (const job of jobs.values()) {
      if (job.kind === 'ready' && job.downloadUrl) URL.revokeObjectURL(job.downloadUrl);
      this.onUpdate({ type: 'remove', id: job.id });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
  }

  private publish(job: ConversionJob): void {
    this.jobs.set(job.id, job);
    this.onUpdate({ type: 'job', job });
  }

  private isCurrent(active: ActiveJob): boolean {
    return !this.disposed && this.active === active && this.jobs.get(active.id)?.kind === 'working';
  }

  private startNext(): void {
    if (this.disposed || this.active) return;
    const request = this.pending.shift();
    if (!request) return;
    const active: ActiveJob = { id: request.id, name: request.name, filename: request.filename };
    this.active = active;
    this.publish({ ...active, kind: 'working', progress: { phase: 'reading', done: 0, archiveCount: 0 } });
    void this.convert(active, request.input);
  }

  private async convert(active: ActiveJob, input: ConversionInput | undefined): Promise<void> {
    try {
      if (!this.isCurrent(active) || !input) return;
      const collection = input.collect((progress) => {
        if (this.isCurrent(active)) this.publish({ ...active, kind: 'working', progress });
      });
      // Only pending requests retain their captured source handles. Completed jobs retain metadata.
      input = undefined;
      const collected = await collection;
      if (!this.isCurrent(active)) return;
      const summary: CollectSummary = {
        normalizedCount: collected.normalizedCount,
        passthroughCount: collected.passthroughCount,
        collisions: collected.collisions,
        archiveCount: collected.archiveCount,
        extractedCount: collected.extractedCount,
        files: collected.files.map(({ zipPath, originalPath, normalized }) => ({ zipPath, originalPath, normalized })),
      };
      if (collected.files.length === 0) {
        this.publish({ ...active, kind: 'ready', collected: summary, expiresAt: Date.now() + RESULT_LIFETIME_MS });
        this.scheduleExpiry();
        return;
      }
      this.publish({
        ...active,
        kind: 'working',
        collected: summary,
        progress: { phase: 'compressing', done: 0, total: collected.files.length, archiveCount: summary.archiveCount },
      });
      await allowPaint();
      if (!this.isCurrent(active)) return;
      const blob = await buildZip(collected.files, (progress) => {
        if (this.isCurrent(active)) this.publish({
          ...active,
          kind: 'working',
          collected: summary,
          progress: { ...progress, phase: 'compressing', archiveCount: summary.archiveCount },
        });
      });
      if (!this.isCurrent(active)) return;
      this.publish({
        ...active,
        kind: 'working',
        collected: summary,
        progress: { phase: 'linking', done: 0, archiveCount: summary.archiveCount },
      });
      await allowPaint();
      if (!this.isCurrent(active)) return;
      const downloadUrl = URL.createObjectURL(blob);
      this.publish({
        ...active,
        kind: 'ready',
        collected: summary,
        zipBytes: blob.size,
        downloadUrl,
        expiresAt: Date.now() + RESULT_LIFETIME_MS,
      });
      this.scheduleExpiry();
    } catch (error) {
      if (this.isCurrent(active)) this.publish({
        ...active,
        kind: 'error',
        message: error instanceof Error ? error.message : '파일 처리 중 오류가 발생했습니다. 다시 선택해주세요.',
      });
    } finally {
      // A cleared job can finish after another job starts; it must not release that job's slot.
      if (this.active === active) {
        this.active = undefined;
        this.startNext();
      }
    }
  }

  private scheduleExpiry(): void {
    window.clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    let nearest = Infinity;
    for (const job of this.jobs.values()) {
      if (job.kind === 'ready') nearest = Math.min(nearest, job.expiresAt);
    }
    if (nearest !== Infinity) this.expiryTimer = window.setTimeout(() => {
      this.expiryTimer = undefined;
      this.checkExpiry();
    }, Math.max(0, nearest - Date.now()));
  }
}
