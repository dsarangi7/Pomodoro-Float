export function versionQuad(version) {
  const parts = String(version ?? "")
    .split(".")
    .map((part) => {
      const match = /^(\d+)/.exec(part);
      return match ? Number(match[1]) : 0;
    });
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join(".");
}

export function executableStampArgs({ exePath, iconPath, pkg, originalFilename }) {
  const quad = versionQuad(pkg.version);
  const productName = pkg.productName || "Pomodoro Float";
  const company = typeof pkg.author === "string" && pkg.author.trim() ? pkg.author.trim() : productName;
  const description = pkg.description || "A calm, always-on-top Pomodoro timer for Windows.";
  const original = originalFilename || "electron.exe";
  return [
    exePath,
    "--set-icon",
    iconPath,
    "--set-file-version",
    quad,
    "--set-product-version",
    quad,
    "--set-version-string",
    "ProductName",
    productName,
    "--set-version-string",
    "CompanyName",
    company,
    "--set-version-string",
    "FileDescription",
    description,
    "--set-version-string",
    "FileVersion",
    quad,
    "--set-version-string",
    "ProductVersion",
    quad,
    "--set-version-string",
    "LegalCopyright",
    `Copyright (c) 2026 ${company}`,
    "--set-version-string",
    "OriginalFilename",
    original,
    "--set-version-string",
    "InternalName",
    "PomodoroFloat",
  ];
}

export const UNBLOCK_LAUNCHER = "Unblock and Launch.cmd";
export const PORTABLE_DIR = "PomodoroFloat";
export const LAUNCHER_EXE = "PomodoroFloat.exe";
export const RUNTIME_EXE = "electron.exe";
export const DEV_LAUNCHER = "Launch-PomodoroFloat.cmd";
