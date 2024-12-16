// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectDirectories: () => ipcRenderer.invoke("select-directories"),
  removeDirectory: (dirPath) => ipcRenderer.invoke("remove-directory", dirPath),
  onLog: (callback) =>
    ipcRenderer.on("log-message", (event, message) => callback(message)),
});
