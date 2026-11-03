import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";

const version = process.argv[2] || "39.8.10";
const targetDir = path.resolve("runtime-download");
const target = path.join(targetDir, `electron-v${version}-win32-x64.zip`);
await mkdir(targetDir, { recursive: true });

const url = `https://npmmirror.com/mirrors/electron/${version}/electron-v${version}-win32-x64.zip`;
console.log(`Downloading ${url}`);
const response = await fetch(url);
if (!response.ok || !response.body) {
  throw new Error(`HTTP ${response.status} for ${url}`);
}
const expected = Number(response.headers.get("content-length")) || 0;
let received = 0;
let lastReport = 0;
const stream = Readable.fromWeb(response.body);
stream.on("data", (chunk) => {
  received += chunk.length;
  const now = Date.now();
  if (now - lastReport > 2000) {
    lastReport = now;
    console.log(`${((received / 1048576) | 0)} MiB / ${((expected / 1048576) | 0)} MiB`);
  }
});
await pipeline(stream, createWriteStream(target));
console.log(`Wrote ${target} (${received} bytes)`);
