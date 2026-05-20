import { EventEmitter } from 'events';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('chokidar');
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));

const mockAppendUndoEntries = vi.fn().mockResolvedValue(undefined);
vi.mock('../store', () => ({ appendUndoEntries: mockAppendUndoEntries }));

const mockQueueRenamedNotification = vi.fn().mockResolvedValue(undefined);
vi.mock('../notifier', () => ({
  queueRenamedNotification: mockQueueRenamedNotification,
  notifyManualQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../nanoid', () => ({ nanoid: () => 'test-id' }));

const mockNormalizeEntry = vi.fn();
vi.mock('../../core/normalizer', () => ({ normalizeEntry: mockNormalizeEntry }));

import chokidar from 'chokidar';
import type { WatchedDir } from '../../core/types';

// 테스트마다 고유 경로를 사용해 모듈 레벨 recentlyRenamed 상태 충돌 방지
function makePaths(slug: string) {
  const nfc = `/test/watch/${slug}.txt`;
  return { nfc, nfd: nfc.normalize('NFD') };
}

function makeDir(id: string): WatchedDir {
  return { id, path: '/test/watch', recursive: false, mode: 'auto', enabled: true, customRanges: [] };
}

describe('watcher — in-flight race condition', () => {
  let mockWatcher: EventEmitter & { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWatcher = Object.assign(new EventEmitter(), { close: vi.fn().mockResolvedValue(undefined) });
    vi.mocked(chokidar.watch).mockReturnValue(mockWatcher as unknown as ReturnType<typeof chokidar.watch>);
  });

  afterEach(async () => {
    const { stopDir } = await import('../watcher');
    // 각 테스트에서 사용한 id 정리
    for (const id of ['dir-burst', 'dir-nfc-reentry', 'dir-nfd-reentry']) {
      await stopDir(id);
    }
  });

  it('동일 NFD 경로에 burst add 이벤트가 와도 normalizeEntry가 1번만 호출된다', async () => {
    const { nfc, nfd } = makePaths('강의자료-burst');
    mockNormalizeEntry.mockResolvedValue({ type: 'file', status: 'renamed', oldPath: nfd, newPath: nfc });

    const { startDir } = await import('../watcher');
    await startDir(makeDir('dir-burst'));

    // 같은 경로를 동기적으로 두 번 emit — race 시나리오 재현
    mockWatcher.emit('add', nfd);
    mockWatcher.emit('add', nfd);
    await new Promise((r) => setTimeout(r, 0));

    expect(mockNormalizeEntry).toHaveBeenCalledTimes(1);
    expect(mockAppendUndoEntries).toHaveBeenCalledTimes(1);
  });

  it('rename 완료 후 NFC 경로로 다시 add 이벤트가 와도 recentlyRenamed 가드에 막힌다', async () => {
    const { nfc, nfd } = makePaths('강의자료-nfc-reentry');
    mockNormalizeEntry.mockResolvedValue({ type: 'file', status: 'renamed', oldPath: nfd, newPath: nfc });

    const { startDir } = await import('../watcher');
    await startDir(makeDir('dir-nfc-reentry'));

    mockWatcher.emit('add', nfd);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNormalizeEntry).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    // RENAME_TTL(2000ms) 이내에 NFC 경로로 재진입 — 가드에 막혀야 함
    mockWatcher.emit('add', nfc);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNormalizeEntry).not.toHaveBeenCalled();
  });

  it('rename 완료 후 NFD 경로로 재진입해도 recentlyRenamed 가드에 막힌다', async () => {
    const { nfc, nfd } = makePaths('강의자료-nfd-reentry');
    mockNormalizeEntry.mockResolvedValue({ type: 'file', status: 'renamed', oldPath: nfd, newPath: nfc });

    const { startDir } = await import('../watcher');
    await startDir(makeDir('dir-nfd-reentry'));

    mockWatcher.emit('add', nfd);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNormalizeEntry).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();

    mockWatcher.emit('add', nfd);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockNormalizeEntry).not.toHaveBeenCalled();
  });
});
