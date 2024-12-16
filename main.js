// main.js
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const chokidar = require("chokidar");
const fs = require("fs").promises;

// 무시할 파일/디렉토리를 결정하는 함수
function shouldIgnore(itemName) {
  const ignoredItems = [".git", "node_modules", ".env"];
  return ignoredItems.includes(itemName);
}

// 파일 이름을 정규화하는 함수
async function normalizeFileName(filePath) {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const newName = oldName.normalize("NFC");

  if (oldName !== newName && !shouldIgnore(oldName)) {
    const newPath = path.join(dir, newName);
    try {
      await fs.rename(filePath, newPath);
      console.log(`이름 변경: "${oldName}" -> "${newName}"`);
      return newPath;
    } catch (error) {
      console.error(`이름 변경 실패 ("${oldName}"):`, error);
      return filePath;
    }
  }
  return filePath;
}

// 디렉토리를 재귀적으로 처리하는 함수
async function processDirectory(dirPath) {
  try {
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
  } catch (error) {
    console.error(`디렉토리 처리 중 오류 발생 ("${dirPath}"):`, error);
  }
}

// 창을 생성하는 함수
function createWindow() {
  const win = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // 보안상 추천
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile("index.html");

  // 개발자 도구 열기 (배포 시 제거 권장)
  // win.webContents.openDevTools();
}

// 애플리케이션 준비 시 창 생성
app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 모든 창이 닫히면 애플리케이션 종료
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// 디렉토리 감시 로직 처리
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
  });

  if (result.canceled) {
    return { canceled: true };
  } else {
    const selectedPath = result.filePaths[0];
    console.log(`선택된 디렉토리: ${selectedPath}`);

    // 기존 감시자 종료 (필요 시)
    if (global.watcher) {
      global.watcher.close();
    }

    // 디렉토리 초기 처리
    await processDirectory(selectedPath);

    // 디렉토리 감시 시작
    global.watcher = chokidar.watch(selectedPath, {
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

    global.watcher
      .on("add", async (filePath) => {
        console.log(`파일 추가됨: "${filePath}"`);
        await normalizeFileName(filePath);
      })
      .on("change", async (filePath) => {
        console.log(`파일 변경됨: "${filePath}"`);
        await normalizeFileName(filePath);
      })
      .on("unlink", (filePath) => {
        console.log(`파일 삭제됨: "${filePath}"`);
      })
      .on("addDir", async (dirPath) => {
        console.log(`디렉토리 추가됨: "${dirPath}"`);
        await processDirectory(dirPath);
      })
      .on("unlinkDir", (dirPath) => {
        console.log(`디렉토리 삭제됨: "${dirPath}"`);
      })
      .on("error", (error) => console.error(`Watcher error: ${error}`))
      .on("ready", () => {
        console.log("초기 스캔 완료. 변경 감시 중...");
      });

    return { canceled: false, path: selectedPath };
  }
});
