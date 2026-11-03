const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const winLaunch = require("../win-launch.js");

const ROOT = path.resolve(__dirname, "..");

test("drive letters skip ones that are already taken", () => {
  const taken = new Set(["Z:", "Y:", "X:"]);
  assert.equal(
    winLaunch.pickDriveLetter((letter) => taken.has(letter)),
    "W:"
  );
  assert.equal(
    winLaunch.pickDriveLetter(() => true),
    ""
  );
});

test("a short exe path is usable only when its directory has no spaces", () => {
  assert.equal(winLaunch.directoryHasSpace("C:\\Temp\\PomodoroFloat"), false);
  assert.equal(winLaunch.directoryHasSpace("G:\\AI_WORKSPACE\\pomodoro float"), true);
  assert.equal(
    winLaunch.usableShortExe("C:\\AI_WOR~1\\POMODO~1\\electron.exe"),
    "C:\\AI_WOR~1\\POMODO~1\\electron.exe"
  );
  assert.equal(winLaunch.usableShortExe("G:\\pomodoro float\\electron.exe"), "");
  assert.equal(winLaunch.usableShortExe("   "), "");
});

test("the windows launcher stub is a 64-bit executable that avoids spaced paths", () => {
  const stub = fs.readFileSync(path.join(ROOT, "scripts", "win-launch", "PomodoroFloat.exe"));
  assert.equal(stub.subarray(0, 2).toString("latin1"), "MZ");
  const pe = stub.readUInt32LE(stub.readUInt32LE(0x3c));
  assert.equal(pe, 0x4550);
  const machine = stub.readUInt16LE(stub.readUInt32LE(0x3c) + 4);
  assert.equal(machine, 0x8664);

  const source = fs.readFileSync(path.join(ROOT, "scripts", "win-launch", "launch.c"), "utf8");
  assert.match(source, /DefineDosDeviceW/);
  assert.match(source, /GetShortPathNameW/);
  assert.match(source, /electron\.exe/);
  assert.match(source, /STATUS_BREAKPOINT/);
  assert.match(source, /CreateProcessW/);
});
