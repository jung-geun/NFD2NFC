import { Notification } from 'electron';
import * as store from './store';

interface Batch {
  count: number;
  timer: ReturnType<typeof setTimeout>;
}

// dirPath → 현재 진행 중인 배치
const batches = new Map<string, Batch>();

/**
 * 자동 변환 알림을 배치에 추가한다.
 * 첫 rename이 들어오면 타이머를 시작하고, 인터벌이 끝나면
 * 그동안 쌓인 총 건수를 담은 알림을 한 번만 발송한다.
 */
export async function queueRenamedNotification(dirPath: string): Promise<void> {
  const settings = await store.getSettings();
  if (!settings.notificationsEnabled) return;

  const intervalMs = (settings.notificationIntervalSecs ?? 30) * 1000;

  let batch = batches.get(dirPath);
  if (!batch) {
    const timer = setTimeout(() => flushBatch(dirPath), intervalMs);
    batch = { count: 0, timer };
    batches.set(dirPath, batch);
  }
  batch.count++;
}

function flushBatch(dirPath: string): void {
  const batch = batches.get(dirPath);
  if (!batch) return;

  const count = batch.count;
  batches.delete(dirPath);

  if (!Notification.isSupported() || count === 0) return;

  const dirName = dirPath.split('/').pop() ?? dirPath;
  new Notification({
    title: 'NFD → NFC 변환 완료',
    body: `"${dirName}" 에서 ${count}개 파일명이 변환되었습니다.`,
    silent: true,
  }).show();
}

/** 수동 모드: 감지 즉시 알림 (사용자 액션 유도) */
export async function notifyManualQueue(count: number, dirPath: string): Promise<void> {
  const settings = await store.getSettings();
  if (!settings.notificationsEnabled) return;
  if (!Notification.isSupported()) return;

  const dirName = dirPath.split('/').pop() ?? dirPath;
  new Notification({
    title: 'NFD 파일 감지됨',
    body: `"${dirName}" 에서 ${count}개 대기 중. 트레이에서 처리하세요.`,
    silent: true,
  }).show();
}

/** 앱 종료 시 남아있는 배치를 즉시 발송 */
export function flushAll(): void {
  for (const [dirPath] of batches) {
    flushBatch(dirPath);
  }
}
