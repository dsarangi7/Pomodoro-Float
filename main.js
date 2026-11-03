"use strict";

const { app, BrowserWindow, Menu, Notification, Tray, clipboard, globalShortcut, ipcMain, nativeImage, screen, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const winLaunch = require("./win-launch");
const updates = require("./update-check");

// A parent folder with spaces makes Chromium exit 0x80000003 before the
// window exists. Leave that path before any window or GPU startup.
winLaunch.relaunchIfNeeded();
winLaunch.armSpaceWorkaround(app);
if (process.env[winLaunch.SPACE_MAP_ENV]) {
  process.on("exit", () => winLaunch.releaseMappedDrive());
}

const APP_ID = "com.pomodorofloat.app";
const FEEDBACK_MAIL = "dsarangi7@gmail.com";
let lastUpdateUrl = "";

function feedbackMailUrl(url) {
  if (typeof url !== "string" || !url.toLowerCase().startsWith("mailto:")) return "";
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const address = decodeURIComponent(parsed.pathname).replace(/^\/+/, "").toLowerCase();
  if (address !== FEEDBACK_MAIL) return "";
  return `mailto:${FEEDBACK_MAIL}`;
}

const IS_SCREENSHOT = process.argv.includes("--screenshot");
// Stage padding is 12px. Widget CSS heights: 304 full, 432 with the task list, 508 history, 60 compact.
const FULL_SIZE = { width: 404, height: 328 };
const TASKS_SIZE = { width: 404, height: 456 };
const HISTORY_SIZE = { width: 404, height: 532 };
const COMPACT_SIZE = { width: 272, height: 84 };
const POSITION_MARGIN = 18;
const SAVE_DELAY = 350;
const DEBUG_LOG = IS_SCREENSHOT ? path.join(process.cwd(), "electron-debug.log") : null;

function debugLog(...parts) {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${parts.join(" ")}\n`);
  } catch {
    /* Diagnostics must never block the app. */
  }
}

process.on("uncaughtException", (error) => {
  debugLog("uncaughtException", error.stack || error.message);
  console.error(error);
});
process.on("unhandledRejection", (error) => {
  debugLog("unhandledRejection", error?.stack || String(error));
  console.error(error);
});

if (IS_SCREENSHOT) {
  try {
    fs.writeFileSync(DEBUG_LOG, "");
  } catch {
    /* ignore */
  }
}

let mainWindow = null;
let tray = null;
let isQuitting = false;
let saveTimer = null;
let timerState = { running: false, display: "25:00", mode: "focus" };
let windowState = { pinned: true, compact: false, tasks: false, history: false };
let statePath = null;
let screenshotErrors = [];

app.setName("Pomodoro Float");

function assetPath(name) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "assets");
  return path.join(base, name);
}
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function stateFile() {
  return statePath || path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return {
      right: Number.isFinite(data.right) ? data.right : null,
      top: Number.isFinite(data.top) ? data.top : null,
      pinned: data.pinned !== false,
    };
  } catch {
    return { right: null, top: null, pinned: true };
  }
}

function writeWindowState() {
  if (IS_SCREENSHOT || !mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  const payload = {
    right: bounds.x + bounds.width,
    top: bounds.y,
    pinned: mainWindow.isAlwaysOnTop(),
  };
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn("Could not save window position:", error.message);
  }
}

function schedulePositionSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(writeWindowState, SAVE_DELAY);
}

function displayForPoint(point) {
  return screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
}

function getInitialBounds(saved) {
  const primary = screen.getPrimaryDisplay().workArea;
  if (saved.right === null || saved.top === null) {
    return {
      x: primary.x + primary.width - FULL_SIZE.width - POSITION_MARGIN,
      y: primary.y + POSITION_MARGIN,
      ...FULL_SIZE,
    };
  }

  const display = displayForPoint({ x: saved.right - 30, y: saved.top + 30 });
  const area = display.workArea;
  const x = Math.min(
    Math.max(saved.right - FULL_SIZE.width, area.x + 4),
    area.x + area.width - FULL_SIZE.width - 4
  );
  const y = Math.min(
    Math.max(saved.top, area.y + 4),
    area.y + area.height - FULL_SIZE.height - 4
  );
  return { x: Math.round(x), y: Math.round(y), ...FULL_SIZE };
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function windowTargetSize() {
  if (windowState.compact) return COMPACT_SIZE;
  if (windowState.history) return HISTORY_SIZE;
  if (windowState.tasks) return TASKS_SIZE;
  return FULL_SIZE;
}

function resizeWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const target = windowTargetSize();
  const bounds = mainWindow.getBounds();
  const right = bounds.x + bounds.width;
  const x = Math.round(right - target.width);
  const display = displayForPoint({ x: right - 10, y: bounds.y + 10 });
  const area = display.workArea;
  const boundedX = Math.min(
    Math.max(x, area.x + 4),
    area.x + area.width - target.width - 4
  );
  const boundedY = Math.min(
    Math.max(bounds.y, area.y + 4),
    area.y + area.height - target.height - 4
  );
  mainWindow.setBounds({
    x: boundedX,
    y: boundedY,
    width: target.width,
    height: target.height,
  });
  schedulePositionSave();
}

function publicWindowState() {
  return {
    pinned: mainWindow ? mainWindow.isAlwaysOnTop() : windowState.pinned,
    compact: windowState.compact,
    tasks: windowState.tasks,
    history: windowState.history,
  };
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  rebuildTrayMenu();
}

function hideWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  rebuildTrayMenu();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideWindow();
  } else {
    showWindow();
  }
}

const modeNames = { focus: "focus", short: "short break", long: "long break" };

function rebuildTrayMenu() {
  if (!tray) return;
  const phase = modeNames[timerState.mode] || "focus";
  const template = [
    {
      label: "Show Pomodoro Float",
      click: showWindow,
    },
    {
      label: `${timerState.display}  ·  ${phase}`,
      enabled: false,
    },
    { type: "separator" },
    {
      label: timerState.running ? "Pause" : "Start",
      click: () => sendToRenderer("timer:command", "toggle"),
    },
    {
      label: "Reset timer",
      click: () => sendToRenderer("timer:command", "reset"),
    },
    {
      label: "Skip phase",
      click: () => sendToRenderer("timer:command", "skip"),
    },
    { type: "separator" },
    {
      label: "Float above windows",
      type: "checkbox",
      checked: mainWindow ? mainWindow.isAlwaysOnTop() : windowState.pinned,
      click: (item) => setPinned(item.checked),
    },
    {
      label: "Settings…",
      click: () => {
        showWindow();
        sendToRenderer("app:open-settings");
      },
    },
    { type: "separator" },
    {
      label: "Quit Pomodoro Float",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip(`Pomodoro Float · ${timerState.display} · ${phase}`);
}

function setPinned(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const pinned = Boolean(value);
  mainWindow.setAlwaysOnTop(pinned, "floating");
  windowState.pinned = pinned;
  sendToRenderer("window:state", publicWindowState());
  rebuildTrayMenu();
  schedulePositionSave();
  return pinned;
}

function createWindow() {
  const savedState = loadWindowState();
  const bounds = getInitialBounds(savedState);
  const pinned = savedState.pinned;

  mainWindow = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    maximizable: false,
    minimizable: true,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: pinned,
    title: "Pomodoro Float",
    icon: assetPath("icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  windowState.pinned = pinned;
  mainWindow.setAlwaysOnTop(pinned, "floating");

  if (IS_SCREENSHOT) {
    mainWindow.setOpacity(0);
  }

  const target = path.join(__dirname, "renderer", "index.html");
  mainWindow.loadFile(target).catch((error) => {
    debugLog("loadFile failed", error.stack || error.message);
  });
  debugLog("createWindow", JSON.stringify(bounds), "pinned", pinned);

  mainWindow.webContents.once("did-finish-load", () => {
    debugLog("did-finish-load");
    setTimeout(() => {
      if (!IS_SCREENSHOT && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 500);
  });

  mainWindow.once("ready-to-show", () => {
    debugLog("ready-to-show");
    if (!IS_SCREENSHOT) mainWindow.show();
  });

  mainWindow.on("show", rebuildTrayMenu);
  mainWindow.on("hide", rebuildTrayMenu);
  mainWindow.on("moved", schedulePositionSave);
  mainWindow.on("resized", schedulePositionSave);

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const mail = feedbackMailUrl(url);
    if (mail) shell.openExternal(mail).catch(() => {});
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();
    const mail = feedbackMailUrl(url);
    if (mail) shell.openExternal(mail).catch(() => {});
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process ended:", details.reason);
  });

  if (IS_SCREENSHOT) {
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) screenshotErrors.push(String(message));
    });
    mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
      screenshotErrors.push(`did-fail-load ${code}: ${description}`);
    });
  }
}

function createTray() {
  let icon = nativeImage.createFromPath(assetPath("icon.ico"));
  if (icon.isEmpty()) {
    icon = nativeImage.createFromPath(assetPath("icon.png"));
  }
  tray = new Tray(icon);
  tray.setToolTip("Pomodoro Float · 25:00 · focus");
  tray.on("click", toggleWindow);
  tray.on("double-click", showWindow);
  rebuildTrayMenu();
}

function registerShortcuts() {
  const shortcuts = [
    ["CommandOrControl+Alt+Space", "toggle"],
    ["CommandOrControl+Alt+R", "reset"],
    ["CommandOrControl+Alt+F", "show"],
  ];
  for (const [accelerator, command] of shortcuts) {
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (command === "show") toggleWindow();
        else sendToRenderer("timer:command", command);
      });
      if (!registered) console.warn(`Shortcut unavailable: ${accelerator}`);
    } catch (error) {
      console.warn(`Shortcut unavailable: ${accelerator}`, error.message);
    }
  }
}

function wireIpc() {
  ipcMain.handle("window:get-state", () => publicWindowState());

  ipcMain.handle("window:set-compact", (_event, value) => {
    windowState.compact = Boolean(value);
    resizeWindow();
    const state = publicWindowState();
    sendToRenderer("window:state", state);
    return state;
  });

  ipcMain.handle("window:set-tasks", (_event, value) => {
    windowState.tasks = Boolean(value);
    if (!windowState.compact) resizeWindow();
    const state = publicWindowState();
    sendToRenderer("window:state", state);
    return state;
  });

  ipcMain.handle("window:set-history", (_event, value) => {
    windowState.history = Boolean(value);
    if (!windowState.compact) resizeWindow();
    const state = publicWindowState();
    sendToRenderer("window:state", state);
    return state;
  });

  ipcMain.handle("window:set-pin", (_event, value) => setPinned(value));

  ipcMain.handle("clipboard:write-text", (_event, text) => {
    const value = typeof text === "string" ? text.slice(0, 8000) : "";
    clipboard.writeText(value);
    return true;
  });

  ipcMain.on("window:hide", hideWindow);

  ipcMain.on("timer:state", (_event, incoming) => {
    if (!incoming || typeof incoming !== "object") return;
    const display = typeof incoming.display === "string" ? incoming.display.slice(0, 8) : "25:00";
    const mode = ["focus", "short", "long"].includes(incoming.mode) ? incoming.mode : "focus";
    const running = Boolean(incoming.running);
    const changed =
      display !== timerState.display ||
      mode !== timerState.mode ||
      running !== timerState.running;
    timerState = { display, mode, running };
    if (changed) rebuildTrayMenu();
  });

  ipcMain.on("notify", (_event, payload) => {
    if (!Notification.isSupported()) return;
    const title = typeof payload?.title === "string" ? payload.title.slice(0, 80) : "Pomodoro Float";
    const body = typeof payload?.body === "string" ? payload.body.slice(0, 200) : "";
    const notification = new Notification({
      title,
      body,
      icon: assetPath("icon.png"),
      silent: true,
    });
    notification.on("click", showWindow);
    notification.show();
  });

  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    pinned: mainWindow ? mainWindow.isAlwaysOnTop() : windowState.pinned,
    compact: windowState.compact,
    shortcuts: {
      toggle: "Ctrl+Alt+Space",
      reset: "Ctrl+Alt+R",
      show: "Ctrl+Alt+F",
    },
  }));

  ipcMain.handle("updates:check", () => checkForUpdates());
  ipcMain.handle("updates:open", async () => {
    if (!updates.isReleasePage(lastUpdateUrl)) return false;
    await shell.openExternal(lastUpdateUrl);
    return true;
  });
}

async function checkForUpdates() {
  const currentVersion = app.getVersion();
  try {
    const response = await fetch(updates.LATEST_API, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "PomodoroFloat",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      let message = "";
      try {
        const payload = await response.json();
        message = typeof payload?.message === "string" ? payload.message : "";
      } catch {
        message = "";
      }
      lastUpdateUrl = "";
      return updates.statusResult(
        updates.classifyHttp(response.status, response.headers.get("x-ratelimit-remaining"), message),
        currentVersion
      );
    }
    const release = await response.json();
    const result = updates.resultFromRelease(currentVersion, release);
    lastUpdateUrl = result.state === "update" ? result.url : "";
    return result;
  } catch {
    lastUpdateUrl = "";
    return updates.statusResult("offline", currentVersion);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureScreenshots() {
  debugLog("captureScreenshots begin");
  const outDir = path.join(process.cwd(), "screenshots");
  fs.mkdirSync(outDir, { recursive: true });
  await delay(1200);
  debugLog("captureScreenshots after delay");

  async function capture(name) {
    const image = await mainWindow.webContents.capturePage();
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, image.toPNG());
    debugLog("saved", file);
  }

  mainWindow.showInactive();
  await delay(500);
  await capture("full");

  await mainWindow.webContents.executeJavaScript(
    'document.querySelector(\'[data-action="compact"]\').click(); true'
  );
  await delay(600);
  await capture("compact");

  await mainWindow.webContents.executeJavaScript(
    'document.querySelector(\'[data-action="expand"]\').click(); true'
  );
  await delay(500);
  await mainWindow.webContents.executeJavaScript(
    'document.querySelector(\'[data-action="settings"]\').click(); true'
  );
  await delay(500);
  await capture("settings");

  if (screenshotErrors.length) {
    debugLog("RENDERER ERRORS", JSON.stringify(screenshotErrors));
    process.exitCode = 1;
  }
  debugLog("captureScreenshots complete");
  isQuitting = true;
  app.quit();
}

debugLog("main.js loaded", process.argv.join(" "));

if (!app.requestSingleInstanceLock()) {
  debugLog("single instance lock not acquired");
  app.quit();
} else {
  app.on("second-instance", () => {
    showWindow();
  });

  app.whenReady().then(() => {
    debugLog("app ready");
    app.setAppUserModelId(APP_ID);
    statePath = path.join(app.getPath("userData"), "window-state.json");
    wireIpc();
    createWindow();
    if (!IS_SCREENSHOT) {
      createTray();
      registerShortcuts();
    }
    if (IS_SCREENSHOT) {
      captureScreenshots().catch((error) => {
        debugLog("capture failed", error?.stack || String(error));
        console.error(error);
        process.exitCode = 1;
        isQuitting = true;
        app.quit();
      });
    }
  });

  app.on("activate", () => {
    if (!mainWindow) createWindow();
    showWindow();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    writeWindowState();
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  app.on("window-all-closed", () => {
    if (IS_SCREENSHOT) app.quit();
  });
}
