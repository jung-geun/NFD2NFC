const fs = require("fs").promises;
const path = require("path");
const chokidar = require("chokidar");

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
  // console.log(`디렉토리 처리 시작: "${dirPath}"`);
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

// 디렉토리를 감시하는 함수
function watchDirectory(directory) {
  const watcher = chokidar.watch(directory, {
    ignored: (pathStr) => {
      const baseName = path.basename(pathStr);
      return shouldIgnore(baseName);
    },
    persistent: true,
    ignoreInitial: false, // 초기 파일 추가 이벤트를 감지
    awaitWriteFinish: {
      stabilityThreshold: 200, // 파일이 완전히 작성될 때까지 대기 (ms)
      pollInterval: 100,
    },
    depth: Infinity, // 하위 디렉토리까지 감시
  });

  watcher
    .on("add", async (filePath) => {
      // console.log(`파일 추가됨: "${filePath}"`);
      await normalizeFileName(filePath);
    })
    .on("change", async (filePath) => {
      // console.log(`파일 변경됨: "${filePath}"`);
      await normalizeFileName(filePath);
    })
    .on("unlink", (filePath) => {
      // console.log(`파일 삭제됨: "${filePath}"`);
    })
    .on("addDir", async (dirPath) => {
      // console.log(`디렉토리 추가됨: "${dirPath}"`);
      await processDirectory(dirPath); // 새 디렉토리를 추가되자마자 처리
    })
    .on("unlinkDir", (dirPath) => {
      // console.log(`디렉토리 삭제됨: "${dirPath}"`);
    })
    .on("error", (error) => console.error(`Watcher error: ${error}`))
    .on("ready", () => {
      console.log("초기 스캔 완료. 변경 감시 중...");
    });

  console.log(`감시 시작: "${directory}"`);
}

// 명령줄 인자로 경로를 받거나 기본값 사용
const targetPath = process.argv[2] || "./convert";

// 디렉토리 감시 시작
watchDirectory(targetPath);
