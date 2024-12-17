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
const fsSync = require("fs"); // For synchronous path checks

let tray = null;
let mainWindow = null;
let watchers = {}; // To keep track of file watchers

// 로그 파일 경로 지정
const logFilePath = path.join(app.getPath("userData"), "watcher.log");

// JSON 파일 경로 지정
const watchedDirectoriesPath = path.join(
  app.getPath("userData"),
  "watchedDirectories.json"
);

// 현재 감시 중인 디렉토리 목록 및 마지막 갱신 시간
let watchedDirectories = {}; // { "path/to/dir": "2024-12-16T23:30:25.615Z", ... }

// Load the directories from JSON
async function loadWatchedDirectories() {
  try {
    const data = await fs.readFile(watchedDirectoriesPath, "utf-8");
    watchedDirectories = JSON.parse(data);
    for (const dirPath of Object.keys(watchedDirectories)) {
      watchDirectory(dirPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Error loading directories: ${error}`);
      new Notification({
        title: "Error",
        body: `Error loading directories: ${error.message}`,
      }).show();
    } else {
      console.log("No watched directories found. Starting fresh.");
      watchedDirectories = {};
    }
  }
}

// Save directories to JSON
async function saveWatchedDirectories() {
  try {
    await fs.writeFile(
      watchedDirectoriesPath,
      JSON.stringify(watchedDirectories, null, 2),
      "utf-8"
    );
  } catch (error) {
    console.error(`Error saving directories: ${error}`);
  }
}

// 로그 기록 함수
async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    await fs.appendFile(logFilePath, logMessage);
  } catch (error) {
    console.error("로그 파일 작성 실패:", error);
  }
}

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
      // watchedDirectories[newPath] = new Date().toISOString();
      // delete watchedDirectories[filePath];
      await saveWatchedDirectories();
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

  // 변경 시 마지막 갱신 시간 업데이트
  // watchedDirectories[filePath] = new Date().toISOString();
  // await saveWatchedDirectories();
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
    // console.log(`디렉토리 처리 완료: "${dirPath}"`);
    // watchedDirectories[dirPath] = new Date().toISOString();
    // await saveWatchedDirectories();
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

// 디렉토리를 감시하는 함수
function watchDirectory(directory) {
  const watcher = chokidar.watch(directory, {
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

  watchers[directory] = watcher;

  watcher
    .on("add", async (filePath) => {
      // await log(`파일 추가됨: "${filePath}"`);
      // if (mainWindow) {
      //   mainWindow.webContents.send(
      //     "log-message",
      //     `파일 추가됨: "${filePath}"`
      //   );
      // }
      await normalizeFileName(filePath);
    })
    .on("change", async (filePath) => {
      // await log(`파일 변경됨: "${filePath}"`);
      // if (mainWindow) {
      //   mainWindow.webContents.send(
      //     "log-message",
      //     `파일 변경됨: "${filePath}"`
      //   );
      // }
      await normalizeFileName(filePath);
    })
    .on("unlink", async (filePath) => {
      // await log(`파일 삭제됨: "${filePath}"`);
      // if (mainWindow) {
      //   mainWindow.webContents.send(
      //     "log-message",
      //     `파일 삭제됨: "${filePath}"`
      //   );
      // }
    })
    .on("addDir", async (dirPath) => {
      // await log(`디렉토리 추가됨: "${dirPath}"`);
      // if (mainWindow) {
      //   mainWindow.webContents.send(
      //     "log-message",
      //     `디렉토리 추가됨: "${dirPath}"`
      //   );
      // }
      await processDirectory(dirPath);
    })
    .on("unlinkDir", async (dirPath) => {
      // await log(`디렉토리 삭제됨: "${dirPath}"`);
      // if (mainWindow) {
      //   mainWindow.webContents.send(
      //     "log-message",
      //     `디렉토리 삭제됨: "${dirPath}"`
      //   );
      // }
    })
    .on("error", async (error) => {
      await log(`Watcher error: ${error}`);
      if (mainWindow) {
        mainWindow.webContents.send("log-message", `Watcher error: ${error}`);
      }
      new Notification({
        title: "Watcher Error",
        body: `Error watching directory: ${error.message}`,
      }).show();
    })
    .on("ready", () => {
      log(
        `초기 스캔 완료. "${directory}"에서 변경 사항을 감시 중입니다.`
      ).catch(console.error);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `초기 스캔 완료. "${directory}"에서 변경 사항을 감시 중입니다.`
        );
      }
    });
}

function setTray() {
  const iconPath = path.join(
    __dirname,
    "build/icons/Macicon.iconset/icon_32x32.png"
  ); // Define iconPath here

  if (!fsSync.existsSync(iconPath)) {
    console.error("Tray icon not found at:", iconPath);
    new Notification({
      title: "Error",
      body: `Tray icon not found at ${iconPath}`,
    }).show();
    return;
  }

  tray = new Tray(iconPath);

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

// 애플리케이션 준비 시 창 및 트레이 설정 후 디렉토리 목록 로드
app.whenReady().then(async () => {
  createWindow();
  setTray();
  await loadWatchedDirectories();

  if (process.platform === "darwin") {
    app.dock.hide();
  }

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 모든 창이 닫히면 애플리케이션 종료 (macOS 특성)
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
    await log(`선택된 디렉토리: "${selectedPaths.join('", "')}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `선택된 디렉토리: "${selectedPaths.join('", "')}"`
      );
    }

    for (const selectedPath of selectedPaths) {
      if (!watchedDirectories.hasOwnProperty(selectedPath)) {
        watchedDirectories[selectedPath] = new Date().toISOString();
        watchDirectory(selectedPath);
      }
    }

    await saveWatchedDirectories();

    // 렌더러 프로세스로 선택된 디렉토리 목록 업데이트 요청
    if (mainWindow) {
      mainWindow.webContents.send("update-directories", watchedDirectories);
    }

    return { canceled: false, paths: selectedPaths };
  }
});

// 디렉토리 제거 핸들러
ipcMain.handle("remove-directory", async (event, dirPath) => {
  if (watchedDirectories.hasOwnProperty(dirPath)) {
    watchedDirectories = Object.keys(watchedDirectories)
      .filter((key) => key !== dirPath)
      .reduce((obj, key) => {
        obj[key] = watchedDirectories[key];
        return obj;
      }, {});
    if (watchers[dirPath]) {
      await watchers[dirPath].close();
      delete watchers[dirPath];
      await log(`디렉토리 감시 중지: "${dirPath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `디렉토리 감시 중지: "${dirPath}"`
        );
        mainWindow.webContents.send("update-directories", watchedDirectories);
      }
    }

    await saveWatchedDirectories();

    return { success: true };
  } else {
    return { success: false, message: "디렉토리가 감시 목록에 없습니다." };
  }
});

ipcMain.handle("get-directories", async () => {
  return watchedDirectories;
});

process.on("unhandledRejection", (reason, promise) => {
  new Notification({
    title: "Unhandled Promise Rejection",
    body: reason.message || "Unknown error",
  }).show();
});

// 창을 생성하는 함수
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 550, // 너비 조정
    height: 550, // 높이 조정
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // 보안상 추천
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");

  mainWindow.on("show", () => {
    mainWindow.webContents.send("get-directories");
  });

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}
