const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function versionString(args, name) {
  for (let index = 0; index < args.length - 2; index += 1) {
    if (args[index] === "--set-version-string" && args[index + 1] === name) {
      return args[index + 2];
    }
  }
  return undefined;
}

test("the portable exe stamp carries product, company, description, and file version", async () => {
  const { versionQuad, executableStampArgs } = await import("../scripts/win-meta.mjs");
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.version, "1.2.2");
  assert.equal(versionQuad(pkg.version), "1.2.2.0");
  assert.equal(versionQuad("1.2"), "1.2.0.0");

  const runtimeArgs = executableStampArgs({
    exePath: "electron.exe",
    iconPath: "assets/icon.ico",
    pkg,
  });
  const fileVersionFlag = runtimeArgs.indexOf("--set-file-version");
  assert.equal(runtimeArgs[fileVersionFlag + 1], "1.2.2.0");
  assert.equal(versionString(runtimeArgs, "ProductName"), "Pomodoro Float");
  assert.equal(versionString(runtimeArgs, "CompanyName"), "Pomodoro Float");
  assert.equal(versionString(runtimeArgs, "FileDescription"), pkg.description);
  assert.equal(versionString(runtimeArgs, "FileVersion"), "1.2.2.0");
  assert.equal(versionString(runtimeArgs, "ProductVersion"), "1.2.2.0");
  assert.equal(versionString(runtimeArgs, "OriginalFilename"), "electron.exe");

  const launcherArgs = executableStampArgs({
    exePath: "PomodoroFloat.exe",
    iconPath: "assets/icon.ico",
    pkg,
    originalFilename: "PomodoroFloat.exe",
  });
  assert.equal(versionString(launcherArgs, "OriginalFilename"), "PomodoroFloat.exe");
  assert.equal(versionString(launcherArgs, "ProductName"), "Pomodoro Float");
});

test("the portable folder is space-free and the launcher quotes its start path", async () => {
  const meta = await import("../scripts/win-meta.mjs");
  assert.equal(meta.PORTABLE_DIR, "PomodoroFloat");
  assert.equal(meta.LAUNCHER_EXE, "PomodoroFloat.exe");
  assert.equal(meta.RUNTIME_EXE, "electron.exe");
  assert.equal(/\s/.test(meta.PORTABLE_DIR), false);
  assert.equal(/\s/.test(meta.LAUNCHER_EXE), false);
  assert.equal(/\s/.test(meta.DEV_LAUNCHER), false);

  const launch = fs.readFileSync(path.join(ROOT, "scripts", "launch-pomodorofloat.cmd"), "utf8");
  assert.match(launch, /\/D "%SAFE_CWD%"/);
  assert.match(launch, /set "LAUNCH=%~dp0PomodoroFloat\.exe"/);
  assert.match(launch, /start "" \/D "%SAFE_CWD%" "%LAUNCH%"/);
  assert.match(launch, /set "ELECTRON_RUN_AS_NODE="/);
  assert.match(launch, /%%~sI/);
  assert.doesNotMatch(launch, /Pomodoro Float\.exe/);

  const unblock = fs.readFileSync(path.join(ROOT, "scripts", "unblock-and-launch.cmd"), "utf8");
  assert.match(unblock, /Unblock-File/);
  assert.match(unblock, /More info/);
  assert.match(unblock, /Run anyway/);
  assert.match(unblock, /code-signing certificate/);
  assert.match(unblock, /does not bypass SmartScreen/);
  assert.match(unblock, /STATUS_BREAKPOINT/);
  assert.match(unblock, /call "%~dp0Launch-PomodoroFloat\.cmd"/);
  assert.doesNotMatch(unblock, /Pomodoro Float\.exe/);

  const buildScript = fs.readFileSync(path.join(ROOT, "scripts", "build-portable.mjs"), "utf8");
  assert.match(buildScript, /executableStampArgs/);
  assert.match(buildScript, /unblock-and-launch\.cmd/);
  assert.match(buildScript, /PORTABLE_DIR/);
  assert.match(buildScript, /win-launch\.js/);
  assert.doesNotMatch(buildScript, /path\.join\(DIST, "Pomodoro Float"\)/);
  assert.doesNotMatch(buildScript, /Pomodoro Float\.exe/);
});
