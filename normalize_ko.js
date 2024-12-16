const fs = require("fs").promises;
const path = require("path");
function containsKorean(text) {
  // 한글 유니코드 범위: 가-힣, ㄱ-ㅎ, ㅏ-ㅣ
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}
// 특정 파일/디렉토리를 무시하는 기능 추가
function shouldIgnore(itemName) {
  const ignoredItems = [".git", "node_modules", ".env"];
  return ignoredItems.includes(itemName);
}

async function normalizeFileName(filePath) {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);

  if (!containsKorean(oldName)) {
    return filePath;
  }

  const newName = oldName.normalize("NFC");

  if (oldName !== newName && !shouldIgnore(oldName)) {
    const newPath = path.join(dir, newName);
    try {
      // 경로에 공백이 있을 경우를 대비해 이스케이프 처리
      const escapedOldPath = filePath.replace(/ /g, "\\ ");
      const escapedNewPath = newPath.replace(/ /g, "\\ ");
      await fs.rename(escapedOldPath, escapedNewPath);
      console.log(`이름 변경: "${oldName}" -> "${newName}"`);
      return newPath;
    } catch (error) {
      console.error(`이름 변경 실패 ("${oldName}"):`, error);
      return filePath;
    }
  }
  return filePath;
}

async function processDirectory(dirPath) {
  try {
    // 경로에 공백이 있을 경우를 대비해 이스케이프 처리
    const escapedDirPath = dirPath.replace(/ /g, "\\ ");
    const entries = await fs.readdir(escapedDirPath, { withFileTypes: true });

    const items = entries.map((entry) => ({
      name: entry.name,
      fullPath: path.join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
    }));

    for (const item of items) {
      if (item.isDirectory) {
        await processDirectory(item.fullPath);
        await normalizeFileName(item.fullPath);
      } else {
        await normalizeFileName(item.fullPath);
      }
    }
  } catch (error) {
    console.error(`디렉토리 처리 중 오류 발생 ("${dirPath}"):`, error);
  }
}

async function processRoot(rootPath) {
  try {
    // 경로에 공백이 있을 경우를 대비해 이스케이프 처리
    const escapedRootPath = path.resolve(rootPath);
    const stats = await fs.stat(escapedRootPath);

    if (stats.isDirectory()) {
      const normalizedRootPath = await normalizeFileName(rootPath);
      await processDirectory(normalizedRootPath);
    } else {
      await normalizeFileName(rootPath);
    }
  } catch (error) {
    console.error(`처리 중 오류 발생 ("${rootPath}"):`, error);
  }
}

// 명령줄 인자로 경로를 받거나 기본값 사용
// 경로에 공백이 있을 경우를 대비해 따옴표로 감싸진 경로도 처리
const targetPath = process.argv[2] || "./convert";

// 프로그램 실행
processRoot(targetPath)
  .then(() => console.log("모든 처리가 완료되었습니다."))
  .catch((error) => console.error("프로그램 실행 중 오류 발생:", error));
