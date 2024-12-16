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
const sqlite3 = require("sqlite3").verbose(); // Ensure sqlite3 is required

let tray = null;
let mainWindow = null;

// Log file path
const logFilePath = path.join(app.getPath("userData"), "watcher.log");

// SQLite database path
const dbPath = path.join(app.getPath("userData"), "directories.db");

// Initialize and connect to the SQLite database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Failed to connect to the SQLite database:", err);
  } else {
    console.log("Connected to the SQLite database.");
  }
});

// Create the directories table if it doesn't exist
db.serialize(() => {
  db.run(
    `
    CREATE TABLE IF NOT EXISTS directories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE
    )
  `,
    (err) => {
      if (err) {
        console.error("Failed to create directories table:", err);
      }
    }
  );
});

// Function to log messages to the log file
async function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  try {
    await fs.appendFile(logFilePath, logMessage);
  } catch (error) {
    console.error("Failed to write to log file:", error);
  }
}

// Function to determine if a file/directory should be ignored
function shouldIgnore(itemName) {
  const ignoredItems = [".git", "node_modules", ".env"];
  return ignoredItems.includes(itemName);
}

// Maintain a list of watched directories and their watchers
let watchedDirectories = [];
let watchers = {};

// Function to load watched directories from the database
function loadWatchedDirectoriesFromDB() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT path FROM directories`, [], (err, rows) => {
      if (err) {
        log(`Failed to load directories from DB: ${err}`).catch(console.error);
        return reject(err);
      }

      watchedDirectories = rows.map((row) => row.path);
      watchedDirectories.forEach((dirPath) => watchDirectory(dirPath));
      log("Loaded watched directories from the database.").catch(console.error);
      resolve();
    });
  });
}

// Function to add a directory to the database
function addDirectoryToDB(dirPath) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO directories (path) VALUES (?)`,
      [dirPath],
      function (err) {
        if (err) {
          log(`Failed to add directory to DB: ${err}`).catch(console.error);
          return reject(err);
        }
        log(`Added directory to DB: "${dirPath}"`).catch(console.error);
        resolve();
      }
    );
  });
}

// Function to remove a directory from the database
function removeDirectoryFromDB(dirPath) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM directories WHERE path = ?`, [dirPath], function (err) {
      if (err) {
        log(`Failed to remove directory from DB: ${err}`).catch(console.error);
        return reject(err);
      }
      log(`Removed directory from DB: "${dirPath}"`).catch(console.error);
      resolve();
    });
  });
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
      await log(`Renamed: "${oldName}" -> "${newName}"`);

      // Show notification
      new Notification({
        title: "Rename Successful",
        body: `"${oldName}" has been renamed to "${newName}".`,
      }).show();

      // Send log message to renderer
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Renamed: "${oldName}" -> "${newName}"`
        );
      }

      return newPath;
    } catch (error) {
      await log(`Failed to rename "${oldName}": ${error}`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Failed to rename "${oldName}": ${error}`
        );
      }
      return filePath;
    }
  }

  return filePath;
}

// Function to process a directory recursively
async function processDirectory(dirPath) {
  try {
    await log(`Processing directory: "${dirPath}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `Processing directory: "${dirPath}"`
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
    await log(`Finished processing directory: "${dirPath}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `Finished processing directory: "${dirPath}"`
      );
    }
  } catch (error) {
    await log(`Error processing directory "${dirPath}": ${error}`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `Error processing directory "${dirPath}": ${error}`
      );
    }
  }
}

// Function to watch a directory
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
      await log(`File added: "${filePath}"`);
      if (mainWindow) {
        mainWindow.webContents.send("log-message", `File added: "${filePath}"`);
      }
      await normalizeFileName(filePath);
    })
    .on("change", async (filePath) => {
      await log(`File changed: "${filePath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `File changed: "${filePath}"`
        );
      }
      await normalizeFileName(filePath);
    })
    .on("unlink", async (filePath) => {
      await log(`File removed: "${filePath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `File removed: "${filePath}"`
        );
      }
    })
    .on("addDir", async (dirPath) => {
      await log(`Directory added: "${dirPath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Directory added: "${dirPath}"`
        );
      }
      await processDirectory(dirPath);
    })
    .on("unlinkDir", async (dirPath) => {
      await log(`Directory removed: "${dirPath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Directory removed: "${dirPath}"`
        );
      }
    })
    .on("error", async (error) => {
      await log(`Watcher error: ${error}`);
      if (mainWindow) {
        mainWindow.webContents.send("log-message", `Watcher error: ${error}`);
      }
    })
    .on("ready", () => {
      log(
        `Initial scan complete. Watching for changes in "${directory}".`
      ).catch(console.error);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Initial scan complete. Watching for changes in "${directory}".`
        );
      }
    });
}

// Function to create the application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"), // Recommended for security
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile("index.html");

  // Open DevTools for debugging (remove in production)
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

// Function to set up the system tray
function setTray() {
  tray = new Tray(path.join(__dirname, "icon.png")); // Ensure 'icon.png' exists in your project directory

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Open",
      click: () => {
        if (mainWindow === null) {
          createWindow();
        } else {
          mainWindow.show();
        }
      },
    },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip("Directory Watcher App");
  tray.setContextMenu(contextMenu);

  // Double-click to open the window
  tray.on("double-click", () => {
    if (mainWindow === null) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
}

// Function to initialize the application
app.whenReady().then(async () => {
  createWindow();
  setTray();
  await loadWatchedDirectoriesFromDB();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit the app when all windows are closed (except on macOS)
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// Handle selecting directories
ipcMain.handle("select-directories", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory", "multiSelections"],
  });

  if (result.canceled) {
    return { canceled: true };
  } else {
    const selectedPaths = result.filePaths;
    console.log(`Selected directories: ${selectedPaths.join(", ")}`);
    await log(`Selected directories: "${selectedPaths.join('", "')}"`);
    if (mainWindow) {
      mainWindow.webContents.send(
        "log-message",
        `Selected directories: "${selectedPaths.join('", "')}"`
      );
    }

    for (const selectedPath of selectedPaths) {
      if (!watchedDirectories.includes(selectedPath)) {
        watchedDirectories.push(selectedPath);
        watchDirectory(selectedPath);
        await addDirectoryToDB(selectedPath);
      }
    }

    return { canceled: false, paths: selectedPaths };
  }
});

// Handle removing a directory
ipcMain.handle("remove-directory", async (event, dirPath) => {
  if (watchedDirectories.includes(dirPath)) {
    watchedDirectories = watchedDirectories.filter((path) => path !== dirPath);
    if (watchers[dirPath]) {
      await watchers[dirPath].close();
      delete watchers[dirPath];
      await log(`Stopped watching directory: "${dirPath}"`);
      if (mainWindow) {
        mainWindow.webContents.send(
          "log-message",
          `Stopped watching directory: "${dirPath}"`
        );
      }
    }

    await removeDirectoryFromDB(dirPath);

    return { success: true };
  } else {
    return { success: false, message: "Directory is not in the watch list." };
  }
});

// Close the database connection when quitting the app
app.on("before-quit", () => {
  db.close((err) => {
    if (err) {
      console.error("Failed to close the database:", err);
    } else {
      console.log("Database connection closed.");
    }
  });
});
