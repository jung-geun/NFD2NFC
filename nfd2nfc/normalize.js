#!/usr/bin/env node

const fs = require("fs").promises;
const path = require("path");
const minimist = require("minimist");
const cliProgress = require("cli-progress");

// Parse command-line arguments
const args = minimist(process.argv.slice(2), {
  alias: { v: "verbose", h: "help" },
  boolean: ["verbose", "help"],
});

// Function to display help message
function displayHelp() {
  console.log(`
    Usage: node index.js [path] [options]
    Options:
      -v, --verbose     Enable verbose logging with progress bar
      -h, --help        Display this help message
    Provide a path directly as an argument
  `);
}

// Check for help flag
if (args.help) {
  displayHelp();
  process.exit(0);
}

// Main processing logic
async function processPath(targetPath) {
  try {
    const stats = await fs.lstat(targetPath);
    const depth = 0;

    if (stats.isDirectory()) {
      await processDirectory(targetPath, depth);
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

  if (oldName !== newName && !shouldIgnore(oldName)) {
    const newPath = path.join(dir, newName);
    try {
      await fs.rename(filePath, newPath);
      return newPath;
    } catch (error) {
      console.error(`Failed to rename "${oldName}":`, error);
      return filePath;
    }
  }
  return filePath;
}

let entriesLength = 0;

// Function to process directories recursively
async function processDirectory(dirPath, depth = 0) {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const filesToProcess = entries.filter(
      (entry) => !entry.isDirectory()
    ).length;
    let processedFiles = 0;
    if (args.verbose && depth == 0) {
      entriesLength = entries.length;
      console.log("Processing directory:", dirPath);
      progressBar.start(entriesLength, 0);
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!shouldIgnore(entry.name)) {
          await processDirectory(fullPath, depth + 1);
        }
      } else {
        await normalizeFileName(fullPath);
      }
      if (args.verbose && filesToProcess > 0 && depth == 0) {
        processedFiles++;
        progressBar.update((processedFiles / entriesLength) * entriesLength);
      }
    }
    await normalizeFileName(dirPath);

    if (args.verbose && depth == 0) {
      progressBar.stop();
    }
  } catch (error) {
    console.error(`Error processing directory "${dirPath}":`, error);
  }
}

// Initialize progress bar
const progressBar = new cliProgress.SingleBar(
  {
    format: "{bar} {percentage}% | {value}/{total}",
    clearOnComplete: false,
  },
  cliProgress.Presets.shades_classic
);

// Handle input: if no flags, assume first non-flag argument is a path
const nonFlagArgs = args._;
if (nonFlagArgs.length > 0) {
  processPath(nonFlagArgs[0]);
} else {
  displayHelp();
}
