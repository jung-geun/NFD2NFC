import { BrowserWindow, shell, app } from 'electron';
import { join } from 'path';

let settingsWin: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 720,
    height: 560,
    title: 'NFD to NFC — 설정',
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
    app.dock?.hide();
  });

  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 로딩 실패 시 콘솔 출력
  settingsWin.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[settings-window] did-fail-load:', code, desc, url);
  });

  const loadPromise = process.env['ELECTRON_RENDERER_URL']
    ? settingsWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/settings/index.html`)
    : settingsWin.loadFile(join(__dirname, '../renderer/settings/index.html'));

  loadPromise
    .then(() => {
      app.dock?.show();
      settingsWin?.show();
      settingsWin?.focus();
      // 개발 모드에서 devtools 자동 오픈
      if (process.env['ELECTRON_RENDERER_URL']) {
        settingsWin?.webContents.openDevTools({ mode: 'detach' });
      }
    })
    .catch((err: Error) => console.error('[settings-window] load error:', err));
}

export function closeSettingsWindow(): void {
  settingsWin?.close();
}
