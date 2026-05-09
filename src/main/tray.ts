import { Tray, Menu, BrowserWindow, nativeImage, app } from 'electron';
import { join } from 'path';
import { openSettingsWindow } from './settings-window';
import * as watcher from './watcher';
import { getDirs } from './store';

let tray: Tray | null = null;
let popoverWin: BrowserWindow | null = null;

function buildTrayIcon(): Electron.NativeImage {
  // resources/ 파일이 있으면 우선 사용
  const iconPath = join(__dirname, '../../resources/tray-icon-Template.png');
  const fromFile = nativeImage.createFromPath(iconPath);
  if (!fromFile.isEmpty()) {
    fromFile.setTemplateImage(true);
    return fromFile;
  }
  // 없으면 32×32 비트맵으로 원형 아이콘 생성 (@2x → 16px 논리 크기)
  const SIZE = 32;
  const data = Buffer.alloc(SIZE * SIZE * 4, 0);
  const cx = SIZE / 2, cy = SIZE / 2, r = SIZE * 0.38;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) {
        const i = (y * SIZE + x) * 4;
        data[i + 3] = 255; // alpha only — template image가 색을 결정
      }
    }
  }
  const img = nativeImage.createFromBitmap(data, { width: SIZE, height: SIZE, scaleFactor: 2.0 });
  img.setTemplateImage(true);
  return img;
}

export function createTray(): void {
  const icon = buildTrayIcon();

  tray = new Tray(icon);
  tray.setToolTip('NFD to NFC 변환기');

  tray.on('click', () => togglePopover());
  tray.on('right-click', () => showContextMenu());
}

function togglePopover(): void {
  if (popoverWin && !popoverWin.isDestroyed()) {
    popoverWin.close();
    return;
  }

  const bounds = tray!.getBounds();
  popoverWin = new BrowserWindow({
    width: 300,
    height: 400,
    x: Math.round(bounds.x - 150 + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height + 4),
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.js'),
    },
  });

  popoverWin.on('blur', () => {
    popoverWin?.close();
  });

  popoverWin.on('closed', () => {
    popoverWin = null;
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    popoverWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/popover/index.html`);
  } else {
    popoverWin.loadFile(join(__dirname, '../renderer/popover/index.html'));
  }

  popoverWin.once('ready-to-show', () => popoverWin?.show());
}

function showContextMenu(): void {
  // watcher 모듈이 단일 진실의 원천 — 여기서 직접 읽음
  const paused = watcher.isGloballyPaused();
  const menu = Menu.buildFromTemplate([
    {
      label: paused ? '감시 재개' : '감시 일시 정지',
      click: async () => {
        if (watcher.isGloballyPaused()) {
          const dirs = await getDirs();
          await watcher.resumeAll(dirs);
        } else {
          await watcher.pauseAll();
        }
      },
    },
    { label: '설정…', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray!.popUpContextMenu(menu);
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
