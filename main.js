// main.js
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  Tray,
  Menu,
} = require("electron");
const path = require("path");
const chokidar = require("chokidar");
const fs = require("fs").promises;

let tray = null;
let mainWindow = null;

// 로그 파일 경로 지정
const logFilePath = path.join(app.getPath("userData"), "watcher.log");

// 로그 기록 함수
async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  await fs.appendFile(logFilePath, logMessage);
}

// 무시할 파일/디렉토리를 결정하는 함수
function shouldIgnore(itemName) {
  const ignoredItems = [".git", "node_modules", ".env"];
  return ignoredItems.includes(itemName);
}

// 현재 감시 중인 디렉토리 목록
let watchedDirectories = [];
let watchers = {};

// 파일 이름을 정규화하는 함수
async function normalizeFileName(filePath) {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const newName = oldName.normalize("NFC");

  if (oldName !== newName && !shouldIgnore(oldName)) {
    const newPath = path.join(dir, newName);
    try {
      await fs.rename(filePath, newPath);
      await log(`이름 변경: "${oldName}" -> "${newName}"`);

      // 알림 생성
      new Notification({
        title: "이름 변경 완료",
        body: `"${oldName}"이 "${newName}"으로 변경되었습니다.`,
      }).show();

      // 렌더러 프로세스로 알림 전송
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `이름 변경: "${oldName}" -> "${newName}"`
        );
      }

      return newPath;
    } catch (error) {
      await log(`이름 변경 실패 ("${oldName}"): ${error}`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `이름 변경 실패 ("${oldName}"): ${error}`
        );
      }
      return filePath;
    }
  }

  return filePath;
}

// 디렉토리를 재귀적으로 처리하는 함수
async function processDirectory(dirPath) {
  try {
    await log(`디렉토리 처리 시작: "${dirPath}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `디렉토리 처리 시작: "${dirPath}"`
      );
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnore(entry.name)) {
          await processDirectory(fullPath);
          await normalizeFileName(fullPath);
        }
      } else {
        await normalizeFileName(fullPath);
      }
    }
    await normalizeFileName(dirPath);
    await log(`디렉토리 처리 완료: "${dirPath}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `디렉토리 처리 완료: "${dirPath}"`
      );
    }
  } catch (error) {
    await log(`디렉토리 처리 중 오류 발생 ("${dirPath}"): ${error}`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `디렉토리 처리 중 오류 발생 ("${dirPath}"): ${error}`
      );
    }
  }
}

// 창을 생성하는 함수
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // 보안상 추천
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");

  // 개발자 도구 열기 (배포 시 제거 권장)
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

// 트레이 메뉴 설정
function setTray() {
  tray = new Tray(path.join(__dirname, "icon.png")); // 메뉴 바 아이콘 경로 (.png 또는 .icns)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "열기",
      click: () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
        }
      },
    },
    {
      label: "종료",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Directory Watcher App");
  tray.setContextMenu(contextMenu);

  // 더블 클릭 시 창 열기
  tray.on("double-click", () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
}

// 애플리케이션 준비 시 창 및 트레이 설정
app.whenReady().then(() => {
  createWindow();
  setTray();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 모든 창이 닫히면 애플리케이션 종료
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// 디렉토리 감시 로직 처리
ipcMain.handle("select-directories", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"],
  });

  if (result.canceled) {
    return { canceled: true };
  } else {
    const selectedPaths = result.filePaths;
    console.log(`선택된 디렉토리: ${selectedPaths.join(", ")}`);
    await log(`선택된 디렉토리: "${selectedPaths.join('", "')}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `선택된 디렉토리: "${selectedPaths.join('", "')}"`
      );
    }

    for (const selectedPath of selectedPaths) {
      if (!watchedDirectories.includes(selectedPath)) {
        watchedDirectories.push(selectedPath);
        await processDirectory(selectedPath);

        // chokidar watcher 설정
        const watcher = chokidar.watch(selectedPath, {
          ignored: (pathStr) => {
            const baseName = path.basename(pathStr);
            return shouldIgnore(baseName);
          },
          persistent: true,
          ignoreInitial: false,
          awaitWriteFinish: {
            stabilityThreshold: 200,
            pollInterval: 100,
          },
          depth: Infinity,
        });

        watchers[selectedPath] = watcher;

        watcher
          .on("add", async (filePath) => {
            await log(`파일 추가됨: "${filePath}"`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `파일 추가됨: "${filePath}"`
              );
            }
            await normalizeFileName(filePath);
          })
          .on("change", async (filePath) => {
            await log(`파일 변경됨: "${filePath}"`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `파일 변경됨: "${filePath}"`
              );
            }
            await normalizeFileName(filePath);
          })
          .on("unlink", async (filePath) => {
            await log(`파일 삭제됨: "${filePath}"`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `파일 삭제됨: "${filePath}"`
              );
            }
          })
          .on("addDir", async (dirPath) => {
            await log(`디렉토리 추가됨: "${dirPath}"`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `디렉토리 추가됨: "${dirPath}"`
              );
            }
            await processDirectory(dirPath);
          })
          .on("unlinkDir", async (dirPath) => {
            await log(`디렉토리 삭제됨: "${dirPath}"`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `디렉토리 삭제됨: "${dirPath}"`
              );
            }
          })
          .on("error", async (error) => {
            await log(`Watcher error: ${error}`);
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                `Watcher error: ${error}`
              );
            }
          })
          .on("ready", () => {
            log("초기 스캔 완료. 변경 감시 중...");
            if (mainWindow) {
              mainWindow.webContents.send(
                "log-message",
                "초기 스캔 완료. 변경 감시 중..."
              );
            }
          });
      }
    }

    // 반환값으로 선택된 경로들을 전달
    return { canceled: false, paths: selectedPaths };
  }
});

// 디렉토리 제거 핸들러
ipcMain.handle("remove-directory", async (event, dirPath) => {
  if (watchedDirectories.includes(dirPath)) {
    watchedDirectories = watchedDirectories.filter((path) => path !== dirPath);
    if (watchers[dirPath]) {
      await watchers[dirPath].close();
      delete watchers[dirPath];
      await log(`디렉토리 감시 중지: "${dirPath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `디렉토리 감시 중지: "${dirPath}"`
        );
      }
    }
    return { success: true };
  } else {
    return { success: false, message: "디렉토리가 감시 목록에 없습니다." };
  }
});
