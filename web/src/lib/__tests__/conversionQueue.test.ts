import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureFileInputs, collectFromFileList, type CollectResult, type ConversionInput } from '../collectFiles';
import { buildZip } from '../buildZip';
import { ConversionQueue, type ConversionJob, type ConversionUpdate } from '../conversionQueue';
import { deferred } from '../deferred';
import { RESULT_LIFETIME_MS } from '../resourcePolicy';

type ReadyJob = Extract<ConversionJob, { kind: 'ready' }>;
type TerminalJob = Extract<ConversionJob, { kind: 'ready' | 'error' }>;

const queues: ConversionQueue[] = [];

function harness() {
  const jobs = new Map<number, ConversionJob>();
  const updates: ConversionUpdate[] = [];
  const completions = new Map<number, Promise<TerminalJob>>();
  const finish = new Map<number, (job: TerminalJob) => void>();
  const queue = new ConversionQueue((update) => {
    updates.push(update);
    if (update.type === 'remove') {
      jobs.delete(update.id);
      return;
    }
    const job = update.job;
    jobs.set(job.id, job);
    if (job.kind === 'queued') {
      const result = deferred<TerminalJob>();
      completions.set(job.id, result.promise);
      finish.set(job.id, result.resolve);
    } else if (job.kind === 'ready' || job.kind === 'error') {
      finish.get(job.id)?.(job);
      finish.delete(job.id);
    }
  });
  queues.push(queue);
  return {
    queue, jobs, updates, completions,
    async ready(id: number): Promise<ReadyJob> {
      const job = await completions.get(id);
      if (job?.kind !== 'ready') throw new Error(`Expected ready job ${id}, got ${job?.kind}`);
      return job;
    },
  };
}

function capture(...files: File[]): ConversionInput[] {
  return captureFileInputs(files as unknown as FileList, false);
}

async function contents(job: ReadyJob) {
  if (!job.downloadUrl) throw new Error('Expected a downloadable archive');
  const response = await fetch(job.downloadUrl);
  const result = await collectFromFileList([new File([await response.blob()], job.filename)]);
  return Promise.all(result.files.map(async ({ zipPath, file }) => ({ path: zipPath, text: await file.text() })));
}

// This only holds a real captured collector at its entry boundary to force lifecycle races.
function hold(input: ConversionInput) {
  const gate = deferred<void>();
  const started = deferred<void>();
  let finished: Promise<CollectResult> | undefined;
  const held: ConversionInput = {
    name: input.name,
    collect(onProgress) {
      started.resolve();
      finished = gate.promise.then(() => input.collect(onProgress));
      return finished;
    },
  };
  return {
    input: held,
    release: gate.resolve,
    started: started.promise,
    get finished() {
      if (!finished) throw new Error('Held collection has not started');
      return finished;
    },
  };
}

beforeEach(() => {
  // The production queue uses browser timers; Node's real Blob URL implementation is retained.
  vi.stubGlobal('window', globalThis);
});

afterEach(() => {
  for (const queue of queues) queue.dispose();
  queues.length = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('continuous conversion results', () => {
  it('keeps separate real file and ZIP downloads, including repeated input names', async () => {
    const source = await collectFromFileList([new File(['archived payload'], '자료.txt'.normalize('NFD'))]);
    const zip = new File([await buildZip(source.files)], 'bundle.zip');
    const h = harness();
    h.queue.enqueue(capture(new File(['first payload'], '한글.txt'.normalize('NFD')), zip));
    const first = await h.ready(1);
    h.queue.enqueue(capture(new File(['later payload'], '한글.txt'.normalize('NFD'))));
    const [second, third] = await Promise.all([h.ready(2), h.ready(3)]);
    expect(new Set([first.filename, second.filename, third.filename]).size).toBe(3);
    expect(new Set([first.downloadUrl, second.downloadUrl, third.downloadUrl]).size).toBe(3);
    expect(await contents(first)).toEqual([{ path: '한글.txt', text: 'first payload' }]);
    expect(await contents(second)).toEqual([{ path: '자료.txt', text: 'archived payload' }]);
    expect(await contents(third)).toEqual([{ path: '한글.txt', text: 'later payload' }]);
    expect(first.collected.files).toEqual([{
      zipPath: '한글.txt', originalPath: '한글.txt'.normalize('NFD'), normalized: true,
    }]);
    expect(second.collected.archiveCount).toBe(1);
    expect([...h.jobs.values()].every((job) => job.kind === 'ready')).toBe(true);
  });

  it('accepts additions during work, preserves order, and isolates real malformed ZIP failures', async () => {
    const h = harness();
    const first = hold(capture(new File(['first'], 'first.txt'))[0]);
    h.queue.enqueue([first.input]);
    await first.started;
    h.queue.enqueue(capture(new File(['not a ZIP'], 'broken.zip'), new File(['last'], 'last.txt')));
    expect(h.jobs.get(1)?.kind).toBe('working');
    expect(h.jobs.get(2)?.kind).toBe('queued');
    expect(h.jobs.get(3)?.kind).toBe('queued');
    first.release();
    const good = await h.ready(1);
    const failed = await h.completions.get(2);
    const last = await h.ready(3);
    expect(failed?.kind).toBe('error');
    expect(await contents(good)).toEqual([{ path: 'first.txt', text: 'first' }]);
    expect(await contents(last)).toEqual([{ path: 'last.txt', text: 'last' }]);
    const terminals = h.updates.flatMap((update) => update.type === 'job' && (update.job.kind === 'ready' || update.job.kind === 'error')
      ? [update.job.id] : []);
    expect(terminals).toEqual([1, 2, 3]);
    const firstTerminal = h.updates.findIndex((update) => update.type === 'job' && update.job.id === 1 && update.job.kind === 'ready');
    const secondWorking = h.updates.findIndex((update) => update.type === 'job' && update.job.id === 2 && update.job.kind === 'working');
    expect(secondWorking).toBeGreaterThan(firstTerminal);
  });

  it('expires only the older result at its deadline without refreshing it for new work', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const h = harness();
    h.queue.enqueue(capture(new File(['old'], 'old.txt')));
    const older = await h.ready(1);
    vi.setSystemTime(older.expiresAt - RESULT_LIFETIME_MS + 60_000);
    h.queue.enqueue(capture(new File(['new'], 'new.txt')));
    const newer = await h.ready(2);
    expect(newer.expiresAt - older.expiresAt).toBe(60_000);
    vi.setSystemTime(older.expiresAt - 1);
    expect(h.queue.canDownload(1)).toBe(true);
    vi.setSystemTime(older.expiresAt);
    expect(h.queue.canDownload(1)).toBe(false);
    expect(h.jobs.get(1)).toEqual({ id: 1, name: 'old.txt', kind: 'expired' });
    expect(h.queue.canDownload(2)).toBe(true);
    expect(revoke.mock.calls).toEqual([[older.downloadUrl]]);
    expect(await contents(newer)).toEqual([{ path: 'new.txt', text: 'new' }]);
    vi.setSystemTime(newer.expiresAt);
    h.queue.checkExpiry();
    expect(h.jobs.get(2)?.kind).toBe('expired');
    expect(revoke.mock.calls).toEqual([[older.downloadUrl], [newer.downloadUrl]]);
  });

  it('schedules the nearest deadline and expires empty results as well as downloadable ones', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
    const h = harness();
    h.queue.enqueue(capture(new File(['one'], 'one.txt')));
    await vi.waitFor(() => expect(h.jobs.get(1)?.kind).toBe('ready'));
    const first = await h.ready(1);
    await vi.advanceTimersByTimeAsync(60_000);
    const empty: ConversionInput = { name: 'empty folder', collect: (progress) => collectFromFileList([], progress) };
    h.queue.enqueue([empty]);
    await vi.waitFor(() => expect(h.jobs.get(2)?.kind).toBe('ready'));
    const second = await h.ready(2);
    expect(second.downloadUrl).toBeUndefined();
    expect(h.queue.canDownload(2)).toBe(false);
    await vi.advanceTimersByTimeAsync(first.expiresAt - Date.now());
    expect(h.jobs.get(1)?.kind).toBe('expired');
    expect(h.jobs.get(2)?.kind).toBe('ready');
    await vi.advanceTimersByTimeAsync(second.expiresAt - Date.now());
    expect(h.jobs.get(2)).toEqual({ id: 2, name: 'empty folder', kind: 'expired' });
  });

  it('keeps a manually removed download alive for one second and clears delayed URLs immediately', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const h = harness();
    h.queue.enqueue(capture(new File(['one'], 'one.txt'), new File(['two'], 'two.txt')));
    await vi.waitFor(() => expect(h.jobs.get(2)?.kind).toBe('ready'));
    const [first, second] = await Promise.all([h.ready(1), h.ready(2)]);
    h.queue.remove(first.id);
    expect(h.jobs.has(first.id)).toBe(false);
    expect(h.queue.canDownload(first.id)).toBe(false);
    if (!first.downloadUrl) throw new Error('Expected a download URL');
    expect((await (await fetch(first.downloadUrl)).arrayBuffer()).byteLength).toBe(first.zipBytes);
    await vi.advanceTimersByTimeAsync(999);
    expect(revoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(revoke.mock.calls).toEqual([[first.downloadUrl]]);
    h.queue.remove(second.id);
    h.queue.clear();
    expect(revoke.mock.calls).toEqual([[first.downloadUrl], [second.downloadUrl]]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it('invalidates held collection after clear, stays reusable, and cannot disturb a newer active job', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const h = harness();
    const old = hold(capture(new File(['old'], 'old.txt'))[0]);
    h.queue.enqueue([old.input, ...capture(new File(['discarded'], 'discarded.txt'))]);
    await old.started;
    h.queue.clear();
    const newer = hold(capture(new File(['new'], 'new.txt'))[0]);
    h.queue.enqueue([newer.input, ...capture(new File(['last'], 'last.txt'))]);
    await newer.started;
    const clearedIndex = h.updates.length;
    old.release();
    await old.finished;
    expect(create).not.toHaveBeenCalled();
    expect(h.jobs.get(3)?.kind).toBe('working');
    expect(h.jobs.get(4)?.kind).toBe('queued');
    expect(h.updates.slice(clearedIndex).some((update) => update.type === 'job' && update.job.id <= 2)).toBe(false);
    newer.release();
    const [third, fourth] = await Promise.all([h.ready(3), h.ready(4)]);
    expect(await contents(third)).toEqual([{ path: 'new.txt', text: 'new' }]);
    expect(await contents(fourth)).toEqual([{ path: 'last.txt', text: 'last' }]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('does not resurrect URLs or updates when a held collection finishes after dispose', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const h = harness();
    const old = hold(capture(new File(['old'], 'old.txt'))[0]);
    h.queue.enqueue([old.input]);
    await old.started;
    h.queue.dispose();
    const disposedIndex = h.updates.length;
    h.queue.enqueue(capture(new File(['ignored'], 'ignored.txt')));
    old.release();
    await old.finished;
    expect(create).not.toHaveBeenCalled();
    expect(h.jobs.size).toBe(0);
    expect(h.updates).toHaveLength(disposedIndex);
  });

  it('removes queued and working jobs without creating downloads for their late completion', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    const h = harness();
    const first = hold(capture(new File(['removed'], 'removed.txt'))[0]);
    h.queue.enqueue([first.input, ...capture(new File(['queued'], 'queued.txt'), new File(['kept'], 'kept.txt'))]);
    await first.started;
    h.queue.remove(2);
    h.queue.remove(1);
    first.release();
    const kept = await h.ready(3);
    expect([...h.jobs.keys()]).toEqual([3]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(await contents(kept)).toEqual([{ path: 'kept.txt', text: 'kept' }]);
  });
});
