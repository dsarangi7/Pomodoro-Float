"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("pomodoro", {
  getWindowState: () => ipcRenderer.invoke("window:get-state"),
  setCompact: (value) => ipcRenderer.invoke("window:set-compact", Boolean(value)),
  setTasksOpen: (value) => ipcRenderer.invoke("window:set-tasks", Boolean(value)),
  setHistoryOpen: (value) => ipcRenderer.invoke("window:set-history", Boolean(value)),
  copyText: (text) => ipcRenderer.invoke("clipboard:write-text", String(text ?? "")),
  setPinned: (value) => ipcRenderer.invoke("window:set-pin", Boolean(value)),
  hide: () => ipcRenderer.send("window:hide"),
  notify: (payload) => ipcRenderer.send("notify", payload),
  updateTimer: (state) => ipcRenderer.send("timer:state", state),
  getInfo: () => ipcRenderer.invoke("app:info"),
  onCommand: (callback) => subscribe("timer:command", callback),
  onWindowState: (callback) => subscribe("window:state", callback),
  onOpenSettings: (callback) => subscribe("app:open-settings", callback),
});
