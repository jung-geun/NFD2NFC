import { app } from 'electron';
import { createTray, destroyTray } from './tray';
import { openSettingsWindow } from './settings-window';
import { registerIpcHandlers } from './ipc';
import * as store from './store';
import * as watcher from './watcher';

// 단일 인스턴스 강제
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createTray();

  // 저장된 디렉토리 감시 복원
  const dirs = await store.getDirs();
  for (const dir of dirs.filter((d) => d.enabled)) {
    watcher.startDir(dir).catch(console.error);
  }

  // 감시 디렉토리가 없으면 설정창 자동 오픈 (첫 실행 안내)
  if (dirs.length === 0) {
    openSettingsWindow();
  }
});

app.on('window-all-closed', () => {
  // 트레이 앱은 윈도우를 모두 닫아도 종료하지 않음
});

app.on('will-quit', async () => {
  destroyTray();
  await watcher.stopAll();
});
