"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const SPACE_SAFE_ENV = "POMODORO_FLOAT_SPACE_SAFE";
const SPACE_MAP_ENV = "POMODORO_FLOAT_SPACE_MAP";

function directoryHasSpace(dir) {
  return /[ \t]/.test(String(dir || ""));
}

function pickDriveLetter(isTaken) {
  for (let code = 90; code >= 68; code -= 1) {
    const letter = `${String.fromCharCode(code)}:`;
    if (!isTaken(letter)) return letter;
  }
  return "";
}

function usableShortExe(shortPath) {
  const trimmed = String(shortPath || "").trim();
  if (!trimmed) return "";
  if (directoryHasSpace(path.win32.dirname(trimmed))) return "";
  return trimmed;
}

function safeCwd() {
  const root = process.env.SystemRoot || process.env.WINDIR || "";
  if (root && !directoryHasSpace(root)) return root;
  return "";
}

function driveIsTaken(letter) {
  try {
    return fs.existsSync(`${letter}\\`);
  } catch {
    return true;
  }
}

function moveOffSpacedWorkingDirectory() {
  if (process.platform !== "win32") return false;
  if (!directoryHasSpace(process.cwd())) return false;
  const next = safeCwd();
  if (!next) return false;
  try {
    process.chdir(next);
    return true;
  } catch {
    return false;
  }
}

function queryShortPath(target) {
  if (process.platform !== "win32" || !target) return "";
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$p=$env:PF_SHORT_PATH; $fso=New-Object -ComObject Scripting.FileSystemObject; if ($fso.FileExists($p)) { Write-Output $fso.GetFile($p).ShortPath } elseif ($fso.FolderExists($p)) { Write-Output $fso.GetFolder($p).ShortPath }",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, PF_SHORT_PATH: target },
    }
  );
  if (result.error || result.status !== 0) return "";
  return usableShortExe(result.stdout || "");
}

function captureLaunchArgs() {
  const args = process.argv.slice(1);
  let packaged = false;
  try {
    packaged = Boolean(require("electron").app?.isPackaged);
  } catch {
    packaged = false;
  }
  if (!packaged && args[0] && !args[0].startsWith("-") && !path.win32.isAbsolute(args[0])) {
    args[0] = path.resolve(args[0]);
  }
  return args;
}

function childEnv(extra) {
  const env = { ...process.env, [SPACE_SAFE_ENV]: "1", ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function spawnDetached(exe, args, cwd, env) {
  const child = spawn(exe, args, {
    cwd,
    env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child;
}

function mapDrive(execDir) {
  for (let code = 90; code >= 68; code -= 1) {
    const letter = `${String.fromCharCode(code)}:`;
    if (driveIsTaken(letter)) continue;
    const mapped = spawnSync("subst.exe", [letter, execDir], {
      windowsHide: true,
      timeout: 8000,
    });
    if (!mapped.error && mapped.status === 0) return letter;
  }
  return "";
}

function releaseMappedDrive() {
  if (process.platform !== "win32") return;
  const letter = process.env[SPACE_MAP_ENV];
  if (!letter || !/^[A-Za-z]:$/.test(letter)) return;
  spawnSync("subst.exe", [letter, "/d"], { windowsHide: true, timeout: 8000 });
  delete process.env[SPACE_MAP_ENV];
}

function armSpaceWorkaround(app) {
  if (process.platform !== "win32" || !app?.commandLine) return false;
  if (!directoryHasSpace(path.win32.dirname(process.execPath))) return false;
  // Relaunch could not hide the spaces. Skip the sandbox broker that
  // aborts with STATUS_BREAKPOINT when its command line is split.
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  return true;
}

/**
 * If this process was started from a directory that contains spaces, start a
 * replacement whose image path has no spaces, then exit. Returns true when
 * the current process should stop. process.exit is used so Electron does not
 * continue into GPU startup on the broken path.
 */
function relaunchIfNeeded() {
  if (process.platform !== "win32") return false;
  const args = captureLaunchArgs();
  const execDir = path.win32.dirname(process.execPath);
  if (process.env[SPACE_SAFE_ENV] === "1" || !directoryHasSpace(execDir)) {
    moveOffSpacedWorkingDirectory();
    return false;
  }

  const shortExe = queryShortPath(process.execPath);
  if (shortExe && fs.existsSync(shortExe)) {
    spawnDetached(shortExe, args, path.win32.dirname(shortExe), childEnv());
    process.exit(0);
  }

  const letter = mapDrive(execDir);
  if (!letter) {
    moveOffSpacedWorkingDirectory();
    return false;
  }
  const exe = `${letter}\\${path.win32.basename(process.execPath)}`;
  if (!fs.existsSync(exe)) {
    spawnSync("subst.exe", [letter, "/d"], { windowsHide: true, timeout: 8000 });
    moveOffSpacedWorkingDirectory();
    return false;
  }
  spawnDetached(exe, args, `${letter}\\`, childEnv({ [SPACE_MAP_ENV]: letter }));
  process.exit(0);
}

module.exports = {
  SPACE_SAFE_ENV,
  SPACE_MAP_ENV,
  directoryHasSpace,
  pickDriveLetter,
  usableShortExe,
  safeCwd,
  moveOffSpacedWorkingDirectory,
  armSpaceWorkaround,
  relaunchIfNeeded,
  releaseMappedDrive,
};
