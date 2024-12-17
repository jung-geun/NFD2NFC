#!/usr/bin/env node

const fs = require("fs").promises;
const path = require("path");
const minimist = require("minimist");

function containsKorean(text) {
  // 한글 유니코드 범위: 가-힣, ㄱ-ㅎ, ㅏ-ㅣ
  return /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text);
}

// Parse command-line arguments
const args = minimist(process.argv.slice(2), {
  alias: { d: "directory", f: "file", v: "verbose", h: "help" },
});

// Function to display help message
function displayHelp() {
  console.log(`
    Usage: node index.js [options]
    Options:
      -d, --directory   Specify a directory to process
      -f, --file        Specify a file to process
      -v, --verbose     Enable verbose logging
      -h, --help        Display this help message
  `);
}

// Check for help flag or no arguments
if (args.help || (!args.directory && !args.file)) {
  displayHelp();
  process.exit(0);
}

// Main processing logic
async function processPath(targetPath) {
  if (!targetPath) {
    console.error("Please provide a path using -d or -f");
    process.exit(1);
  }
  try {
    const stats = await fs.lstat(targetPath);
    if (stats.isDirectory()) {
      await processDirectory(targetPath);
    } else if (stats.isFile()) {
      await normalizeFileName(targetPath);
    }
  } catch (error) {
    console.error(`Error processing path "${targetPath}":`, error);
  }
}

// Function to determine if a file/directory should be ignored
function shouldIgnore(itemName) {
  const ignoredItems = [".git", "node_modules", ".env"];
  return ignoredItems.includes(itemName);
}

// Function to normalize file names
async function normalizeFileName(filePath) {
  const dir = path.dirname(filePath);
  const oldName = path.basename(filePath);
  const newName = oldName.normalize("NFC");

  if (
    oldName !== newName &&
    !shouldIgnore(oldName) &&
    containsKorean(oldName)
  ) {
    const newPath = path.join(dir, newName);
    try {
      await fs.rename(filePath, newPath);
      if (args.verbose) {
        console.log(`Renamed: "${oldName}" -> "${newName}"`);
      }
      return newPath;
    } catch (error) {
      console.error(`Failed to rename "${oldName}":`, error);
      return filePath;
    }
  }
  return filePath;
}

// Function to process directories recursively
async function processDirectory(dirPath) {
  if (args.verbose) {
    console.log(`Processing directory: "${dirPath}"`);
  }
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
    console.error(`Error processing directory "${dirPath}":`, error);
  }
}

// Process the given path based on arguments
if (args.directory) {
  processPath(args.directory);
} else if (args.file) {
  processPath(args.file);
}
