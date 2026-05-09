import React, { useEffect, useState, useCallback } from 'react';
import type { WatchedDir, UndoEntry, AppSettings } from '../../core/types';

const api = (window as any).api;

type Tab = 'dirs' | 'undo' | 'general';

export function Settings() {
  const [tab, setTab] = useState<Tab>('dirs');

  return (
    <div className="settings">
      <div className="settings-header">
        <h1>NFD → NFC 설정</h1>
      </div>
      <div className="tabs">
        {(['dirs', 'undo', 'general'] as Tab[]).map((t) => (
          <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {{ dirs: '디렉토리', undo: 'Undo 기록', general: '일반' }[t]}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tab === 'dirs' && <DirsTab />}
        {tab === 'undo' && <UndoTab />}
        {tab === 'general' && <GeneralTab />}
      </div>
    </div>
  );
}

// ── 디렉토리 탭 ──
function DirsTab() {
  const [dirs, setDirs] = useState<WatchedDir[]>([]);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<Record<string, unknown[]>>({});

  const refresh = useCallback(async () => setDirs(await api.dirs.list()), []);
  useEffect(() => { refresh(); }, [refresh]);

  const addDir = async () => {
    const p = await api.dirs.selectDirectory();
    if (!p) return;
    await api.dirs.add(p);
    refresh();
  };

  const removeDir = async (id: string) => {
    await api.dirs.remove(id);
    refresh();
  };

  const toggleEnabled = async (dir: WatchedDir) => {
    await api.dirs.update(dir.id, { enabled: !dir.enabled });
    refresh();
  };

  const toggleMode = async (dir: WatchedDir) => {
    await api.dirs.update(dir.id, { mode: dir.mode === 'auto' ? 'manual' : 'auto' });
    refresh();
  };

  const toggleRecursive = async (dir: WatchedDir) => {
    await api.dirs.update(dir.id, { recursive: !dir.recursive });
    refresh();
  };

  const dryRun = async (id: string) => {
    setScanning(id);
    const results = await api.dirs.scan(id);
    setScanResults((prev) => ({ ...prev, [id]: results }));
    setScanning(null);
  };

  return (
    <div>
      <div className="add-dir-bar">
        <button onClick={addDir}>+ 디렉토리 추가</button>
        <span style={{ fontSize: 11, color: '#8e8e93' }}>감시할 디렉토리를 추가하세요</span>
      </div>

      {dirs.length === 0 && <div className="empty-state" style={{ marginTop: 40 }}>추가된 디렉토리가 없습니다.</div>}

      {dirs.map((dir) => (
        <div key={dir.id} className="section">
          <div className="card">
            <div className="card-row">
              <div>
                <div style={{ fontWeight: 600 }}>{dir.path.split('/').pop()}</div>
                <div className="row-desc">{dir.path}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="secondary" onClick={() => dryRun(dir.id)} disabled={scanning === dir.id}>
                  {scanning === dir.id ? '스캔 중…' : '미리보기'}
                </button>
                <button className="danger" onClick={() => removeDir(dir.id)}>삭제</button>
              </div>
            </div>
            <div className="card-row">
              <label>감시 활성화</label>
              <input type="checkbox" checked={dir.enabled} onChange={() => toggleEnabled(dir)} />
            </div>
            <div className="card-row">
              <div>
                <div>모드: <strong>{dir.mode === 'auto' ? '자동 변환' : '수동 승인'}</strong></div>
                <div className="row-desc">
                  {dir.mode === 'auto' ? 'NFD 감지 즉시 자동 rename' : '감지 후 사용자 확인 필요'}
                </div>
              </div>
              <button className="secondary" onClick={() => toggleMode(dir)}>전환</button>
            </div>
            <div className="card-row">
              <label>하위 폴더 포함 (재귀)</label>
              <input type="checkbox" checked={dir.recursive} onChange={() => toggleRecursive(dir)} />
            </div>
            <div className="card-row">
              <div>
                <div>추가 필터 범위</div>
                <div className="row-desc">hex 범위 (예: 0300-036F). 한글은 기본 포함.</div>
              </div>
              <RangeEditor dir={dir} onRefresh={refresh} />
            </div>
          </div>

          {scanResults[dir.id] && (
            <ScanPreview results={scanResults[dir.id]} onClose={() => setScanResults((p) => { const n = {...p}; delete n[dir.id]; return n; })} />
          )}
        </div>
      ))}
    </div>
  );
}

function RangeEditor({ dir, onRefresh }: { dir: WatchedDir; onRefresh: () => void }) {
  const [input, setInput] = useState('');

  const addRange = async () => {
    const parts = input.trim().split('-');
    if (parts.length !== 2) return;
    const lo = parseInt(parts[0], 16);
    const hi = parseInt(parts[1], 16);
    if (isNaN(lo) || isNaN(hi)) return;
    await api.dirs.update(dir.id, { customRanges: [...dir.customRanges, [lo, hi]] });
    setInput('');
    onRefresh();
  };

  const removeRange = async (idx: number) => {
    const newRanges = dir.customRanges.filter((_, i) => i !== idx);
    await api.dirs.update(dir.id, { customRanges: newRanges });
    onRefresh();
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
        <input
          type="text"
          placeholder="0300-036F"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          style={{ width: 120 }}
          onKeyDown={(e) => e.key === 'Enter' && addRange()}
        />
        <button className="secondary" onClick={addRange}>추가</button>
      </div>
      <div className="range-list">
        {dir.customRanges.map(([lo, hi], i) => (
          <span key={i} className="range-tag" title="클릭해서 제거" onClick={() => removeRange(i)}>
            {lo.toString(16).toUpperCase()}-{hi.toString(16).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScanPreview({ results, onClose }: { results: unknown[]; onClose: () => void }) {
  return (
    <div style={{ background: '#fff', borderRadius: 10, border: '1px solid #e5e5ea', padding: 12, marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>미리보기 ({results.length}개)</strong>
        <button className="secondary" onClick={onClose}>닫기</button>
      </div>
      {results.length === 0 && <div style={{ color: '#8e8e93', fontSize: 12 }}>변환 대상 없음</div>}
      {results.map((r: any, i) => (
        <div key={i} style={{ fontSize: 11, color: '#3c3c43', padding: '2px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {r.type === 'directory' ? '📁' : '📄'} {r.path.split('/').pop()}
        </div>
      ))}
    </div>
  );
}

// ── Undo 탭 ──
function UndoTab() {
  const [log, setLog] = useState<UndoEntry[]>([]);

  const refresh = useCallback(async () => {
    const entries = await api.undo.list();
    setLog([...entries].reverse().slice(0, 200));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const revertEntry = async (entry: UndoEntry) => {
    await api.undo.revertEntry(entry);
    refresh();
  };

  const revertBatch = async () => {
    await api.undo.revertLastBatch();
    refresh();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 12, color: '#8e8e93' }}>최대 1000개 보관</span>
        <button className="secondary" onClick={revertBatch}>마지막 배치 되돌리기</button>
      </div>
      <div className="undo-list">
        {log.length === 0 && <div className="empty-state">Undo 기록이 없습니다.</div>}
        {log.map((entry) => (
          <div key={entry.id} className={`undo-item${entry.reverted ? ' reverted' : ''}`}>
            <div className="undo-paths">
              <div className="undo-old">↩ {entry.oldPath.split('/').pop()}</div>
              <div className="undo-new">→ {entry.newPath.split('/').pop()}</div>
            </div>
            <div className="undo-ts">{new Date(entry.ts).toLocaleTimeString('ko-KR')}</div>
            {!entry.reverted && (
              <button className="secondary" style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => revertEntry(entry)}>
                되돌리기
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 일반 탭 ──
function GeneralTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    api.settings.get().then(setSettings);
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    await api.settings.update(patch);
    setSettings((prev) => prev ? { ...prev, ...patch } : prev);
  };

  if (!settings) return <div className="empty-state">로딩 중…</div>;

  return (
    <div>
      <div className="section">
        <div className="section-title">동작</div>
        <div className="card">
          <div className="card-row">
            <div>
              <label>기본 변환 모드</label>
              <div className="row-desc">새 디렉토리 추가 시 기본으로 적용</div>
            </div>
            <select
              value={settings.defaultMode}
              onChange={(e) => update({ defaultMode: e.target.value as 'auto' | 'manual' })}
            >
              <option value="auto">자동 변환</option>
              <option value="manual">수동 승인</option>
            </select>
          </div>
          <div className="card-row">
            <label>macOS 알림 활성화</label>
            <input
              type="checkbox"
              checked={settings.notificationsEnabled}
              onChange={(e) => update({ notificationsEnabled: e.target.checked })}
            />
          </div>
          <div className="card-row">
            <div>
              <label>알림 인터벌 (초)</label>
              <div className="row-desc">지정 시간마다 변환 건수를 한 번에 알림</div>
            </div>
            <input
              type="number"
              min={5}
              max={3600}
              step={5}
              disabled={!settings.notificationsEnabled}
              value={settings.notificationIntervalSecs ?? 30}
              onChange={(e) => {
                const v = Math.max(5, Math.min(3600, Number(e.target.value)));
                update({ notificationIntervalSecs: v });
              }}
              style={{ width: 70 }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
