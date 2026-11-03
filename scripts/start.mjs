import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const { directoryHasSpace, safeCwd } = require("../win-launch.js");

const localRuntime = path.resolve("runtime39", "electron.exe");
const installedRuntime = path.resolve("node_modules", "electron", "dist", "electron.exe");
const executable = existsSync(localRuntime) ? localRuntime : installedRuntime;

if (!existsSync(executable)) {
  console.error("Electron runtime not found. Run `npm install` or fetch runtime39 first.");
  process.exit(1);
}

delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_NO_ATTACH_CONSOLE;

const appDir = path.resolve(".");
let cwd = appDir;
if (process.platform === "win32" && directoryHasSpace(appDir)) {
  cwd = safeCwd() || appDir;
}

const child = spawn(executable, [appDir], {
  cwd,
  env: process.env,
  stdio: "inherit",
});
child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
