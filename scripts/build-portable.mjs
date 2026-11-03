import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEV_LAUNCHER,
  executableStampArgs,
  LAUNCHER_EXE,
  PORTABLE_DIR,
  RUNTIME_EXE,
  UNBLOCK_LAUNCHER,
} from "./win-meta.mjs";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const RUNTIME = path.join(ROOT, "runtime39");
const DOWNLOAD = path.join(ROOT, "runtime-download");
const BUILD = path.join(ROOT, "build");
const APP_STAGE = path.join(BUILD, "app");
const DIST = path.join(ROOT, "dist");
const OUTPUT_DIR = path.join(DIST, PORTABLE_DIR);
const ZIP_PATH = path.join(DIST, `Pomodoro-Float-${pkg.version}-win64.zip`);
const SEVEN_ZIP = path.join(ROOT, "node_modules", "7zip-bin", "win", "x64", "7za.exe");
const RCEDIT = path.join(ROOT, "node_modules", "rcedit", "bin", "rcedit-x64.exe");

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(exe)} exited with code ${result.status}`);
  }
}

async function ensureRuntime() {
  if (fs.existsSync(path.join(RUNTIME, "electron.exe"))) return;
  if (!fs.existsSync(SEVEN_ZIP)) {
    throw new Error("7zip-bin is missing. Run `npm install` first.");
  }
  const version = "39.8.10";
  const zip = path.join(DOWNLOAD, `electron-v${version}-win32-x64.zip`);
  if (!fs.existsSync(zip)) {
    console.log("Electron runtime not found; downloading it from the npm mirror...");
    run(process.execPath, [path.join(ROOT, "scripts", "fetch-electron.mjs"), version], {
      cwd: ROOT,
    });
  }
  console.log("Extracting Electron runtime...");
  await fsp.mkdir(RUNTIME, { recursive: true });
  run(SEVEN_ZIP, ["x", zip, `-o${RUNTIME}`, "-y"]);
}

async function stageApp() {
  await fsp.rm(APP_STAGE, { recursive: true, force: true });
  await fsp.mkdir(APP_STAGE, { recursive: true });

  for (const file of ["main.js", "preload.js", "win-launch.js", "LICENSE"]) {
    await fsp.copyFile(path.join(ROOT, file), path.join(APP_STAGE, file));
  }
  for (const dir of ["renderer", "assets"]) {
    await fsp.cp(path.join(ROOT, dir), path.join(APP_STAGE, dir), { recursive: true });
  }

  const runtimePackage = {
    name: pkg.name,
    productName: pkg.productName,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    author: pkg.author,
    license: pkg.license,
  };
  await fsp.writeFile(
    path.join(APP_STAGE, "package.json"),
    `${JSON.stringify(runtimePackage, null, 2)}\n`
  );
}

async function createAsar(target) {
  await asar.createPackage(APP_STAGE, target);
}

async function stampExecutable(exePath) {
  if (!fs.existsSync(RCEDIT)) {
    console.warn("rcedit not found; leaving the default Electron executable icon.");
    return;
  }
  try {
    run(
      RCEDIT,
      executableStampArgs({
        exePath,
        iconPath: path.join(ROOT, "assets", "icon.ico"),
        pkg,
        originalFilename: path.basename(exePath),
      })
    );
  } catch (error) {
    console.warn(`Could not stamp executable metadata: ${error.message}`);
  }
}

async function writeText(filePath, text) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  await fsp.writeFile(filePath, normalized.endsWith("\r\n") ? normalized : `${normalized}\r\n`);
}

async function writePortableExtras() {
  const readme = `POMODORO FLOAT ${pkg.version}
================================

A calm, always-on-top Pomodoro timer.

HOW TO RUN
----------
1. Keep this whole folder together. The folder name is PomodoroFloat
   (no spaces) so a normal unzip does not add a space of its own.
2. The first time, double-click "Unblock and Launch.cmd".
   It clears the downloaded-from-the-internet mark, then starts the app.
3. If Windows SmartScreen still appears, choose More info, then Run anyway.
   You can also right-click PomodoroFloat.exe, open Properties, and tick
   Unblock next to Security.
4. After that, double-click PomodoroFloat.exe.
   From a developer terminal, use "Launch-PomodoroFloat.cmd" instead.
   Do not double-click electron.exe. That file is the runtime.

PATHS WITH SPACES
-----------------
Electron can exit immediately with STATUS_BREAKPOINT (0x80000003) when a
parent folder contains a space, for example "pomodoro float". That is not
the SmartScreen prompt.

PomodoroFloat.exe starts electron.exe from a space-free path (an 8.3 short
name, or a temporary drive letter) and uses a working directory without
spaces. If the app still closes immediately, move this whole folder to a
path without spaces, such as C:\\PomodoroFloat, and start PomodoroFloat.exe
again.

This build is unsigned. SmartScreen steps are how you get past the blue
window. A code-signing certificate is required to silence SmartScreen
completely; this folder does not include one and does not bypass the prompt.

The timer floats above other windows. Closing the window hides it to the
tomato tray icon so the countdown keeps running. Today's short task list
sits on the card, under the timer. History on that row opens a month view
of earlier days. Copy on a selected day puts that date and its tasks on
the clipboard. Task lists are kept for 120 days.

ABOUT
-----
Made by Dibya (dsarangi7).
Feedback: dsarangi7@gmail.com

SHORTCUTS
---------
Space            Start / pause
R                Reset current phase
C                Compact / expand
S                Settings
P                Toggle always-on-top
Esc              Close settings or history

Ctrl+Alt+Space   Start / pause from anywhere
Ctrl+Alt+R       Reset from anywhere
Ctrl+Alt+F       Show / hide the window

TRAY
----
Right-click the tomato icon for start, pause, reset, skip, settings, and quit.

DATA
----
Settings, local stats, and the daily task list are stored in
%APPDATA%\\Pomodoro Float.
There is no network access and no account.
`;
  await writeText(path.join(OUTPUT_DIR, "README.txt"), readme);
  const launchCmd = await fsp.readFile(path.join(ROOT, "scripts", "launch-pomodorofloat.cmd"), "utf8");
  await writeText(path.join(OUTPUT_DIR, DEV_LAUNCHER), launchCmd);
  const launcher = await fsp.readFile(path.join(ROOT, "scripts", "unblock-and-launch.cmd"), "utf8");
  await writeText(path.join(OUTPUT_DIR, UNBLOCK_LAUNCHER), launcher);
}

async function build() {
  await ensureRuntime();
  console.log("Staging app...");
  await stageApp();

  console.log("Cleaning previous portable build...");
  await fsp.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fsp.rm(ZIP_PATH, { force: true });
  await fsp.mkdir(DIST, { recursive: true });

  console.log("Copying Electron runtime...");
  await fsp.cp(RUNTIME, OUTPUT_DIR, { recursive: true });

  console.log("Packing resources/app.asar...");
  await createAsar(path.join(OUTPUT_DIR, "resources", "app.asar"));
  await fsp.cp(path.join(ROOT, "assets"), path.join(OUTPUT_DIR, "resources", "assets"), {
    recursive: true,
  });

  const runtimeExe = path.join(OUTPUT_DIR, RUNTIME_EXE);
  const launcherExe = path.join(OUTPUT_DIR, LAUNCHER_EXE);
  const stub = path.join(ROOT, "scripts", "win-launch", LAUNCHER_EXE);
  if (!fs.existsSync(stub)) {
    throw new Error(`Missing launcher stub: ${stub}`);
  }
  await fsp.copyFile(stub, launcherExe);
  await stampExecutable(runtimeExe);
  await stampExecutable(launcherExe);
  await writePortableExtras();

  console.log("Creating portable zip...");
  run(SEVEN_ZIP, ["a", "-tzip", "-mx=5", ZIP_PATH, PORTABLE_DIR], { cwd: DIST });

  const exeSize = fs.statSync(runtimeExe).size;
  const zipSize = fs.statSync(ZIP_PATH).size;
  console.log("");
  console.log(`Launcher: ${launcherExe}`);
  console.log(`Runtime: ${runtimeExe}`);
  console.log(`Portable zip: ${ZIP_PATH}`);
  console.log(`EXE ${(exeSize / 1048576).toFixed(1)} MiB · ZIP ${(zipSize / 1048576).toFixed(1)} MiB`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
