import React, { useEffect, useState, useCallback } from 'react';
import type { WatchedDir, ActivityEvent } from '../../core/types';

const api = (window as any).api;

export function Popover() {
  const [dirs, setDirs] = useState<WatchedDir[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    setDirs(await api.dirs.list());
  }, []);

  useEffect(() => {
    // 초기 상태: main process에서 직접 읽음 (단일 진실의 원천)
    api.watcher.status().then(({ paused: p }: { paused: boolean }) => setPaused(p));
    refresh();

    const unsubActivity = api.events.onActivity((ev: ActivityEvent) => {
      setActivity((prev) => [ev, ...prev].slice(0, 20));
      refresh();
    });

    // main에서 pause 상태가 바뀔 때마다 업데이트 (트레이 컨텍스트 메뉴 포함)
    const unsubPaused = api.events.onPausedChange((p: boolean) => setPaused(p));

    return () => {
      unsubActivity();
      unsubPaused();
    };
  }, [refresh]);

  const togglePause = async () => {
    if (paused) {
      await api.watcher.resumeAll();
    } else {
      await api.watcher.pauseAll();
    }
    // 상태는 onPausedChange 이벤트로 자동 반영되므로 직접 setPaused 불필요
  };

  return (
    <div className="popover">
      <div className="popover-header">
        <h1>NFD → NFC</h1>
        <div className="popover-actions">
          <button className="secondary" onClick={togglePause} title={paused ? '재개' : '일시정지'}>
            {paused ? '▶ 재개' : '⏸ 정지'}
          </button>
        </div>
      </div>

      <div className="dir-list">
        {dirs.length === 0 && (
          <div className="empty-state">
            감시 중인 디렉토리가 없습니다.<br />
            설정에서 추가하세요.
          </div>
        )}
        {dirs.map((dir) => (
          <DirRow key={dir.id} dir={dir} paused={paused} onRefresh={refresh} />
        ))}
      </div>

      <div className="activity-log">
        <h3>최근 활동</h3>
        {activity.length === 0 && <div className="activity-item">활동 없음</div>}
        {activity.map((ev, i) => (
          <div key={i} className={`activity-item ${ev.type === 'error' || ev.type === 'collision' ? 'error' : ''}`}>
            {ev.message.split('/').pop() ?? ev.message}
          </div>
        ))}
      </div>

      <div className="popover-footer">
        <button className="secondary" onClick={() => api.undo.revertLastBatch()}>Undo 마지막 배치</button>
      </div>
    </div>
  );
}

function DirRow({ dir, paused, onRefresh }: { dir: WatchedDir; paused: boolean; onRefresh: () => void }) {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (dir.mode === 'manual') {
      api.dirs.pendingQueue(dir.id).then((q: string[]) => setPending(q.length));
    }
  }, [dir]);

  const applyQueue = async () => {
    await api.dirs.applyQueue(dir.id);
    setPending(0);
    onRefresh();
  };

  const statusClass = paused ? 'paused' : dir.enabled ? 'active' : 'disabled';
  const dirName = dir.path.split('/').pop() ?? dir.path;

  return (
    <div className="dir-row">
      <div className={`status-dot ${statusClass}`} title={statusClass} />
      <div className="dir-info">
        <div className="dir-name">{dirName}</div>
        <div className="dir-path">{dir.path}</div>
      </div>
      {dir.mode === 'manual' && pending > 0 && (
        <button onClick={applyQueue}>{pending}개 변환</button>
      )}
    </div>
  );
}
