"use strict";

const REPO = "dsarangi7/Pomodoro-Float";
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const LATEST_PAGE = `https://github.com/${REPO}/releases/latest`;

function parseVersion(value) {
  const match = String(value ?? "")
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function summarizeNotes(body) {
  const lines = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim())
    .filter((line) => line && !/^https?:\/\//i.test(line));
  const text = lines.slice(0, 2).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= 140) return text;
  return `${text.slice(0, 137).trimEnd()}…`;
}

function isReleasePage(url) {
  if (typeof url !== "string" || !url) return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname === "github.com" &&
    parsed.pathname.toLowerCase().startsWith(`/${REPO.toLowerCase()}/releases`)
  );
}

function releasePageUrl(release) {
  const page = typeof release?.html_url === "string" ? release.html_url : "";
  return isReleasePage(page) ? page : LATEST_PAGE;
}

function statusResult(state, currentVersion) {
  const messages = {
    offline: "Couldn't reach GitHub. Try again.",
    "rate-limited": "GitHub is limiting update checks. Try again later.",
    error: "Couldn't check for updates.",
  };
  return {
    state: messages[state] ? state : "error",
    message: messages[state] || messages.error,
    currentVersion: String(currentVersion ?? ""),
    latestVersion: "",
    notes: "",
    url: "",
  };
}

function classifyHttp(status, rateRemaining, message) {
  const limited = String(rateRemaining ?? "") === "0" || /rate limit/i.test(String(message || ""));
  if (status === 429 || (status === 403 && limited)) return "rate-limited";
  return "error";
}

function resultFromRelease(currentVersion, release) {
  const latestVersion = String(release?.tag_name ?? "")
    .trim()
    .replace(/^v/i, "");
  const order = compareVersions(latestVersion, currentVersion);
  if (order === null) return statusResult("error", currentVersion);
  if (order > 0) {
    return {
      state: "update",
      message: `v${latestVersion} is available.`,
      currentVersion: String(currentVersion ?? ""),
      latestVersion,
      notes: summarizeNotes(release?.body),
      url: releasePageUrl(release),
    };
  }
  return {
    state: "current",
    message: "You're up to date.",
    currentVersion: String(currentVersion ?? ""),
    latestVersion,
    notes: "",
    url: "",
  };
}

module.exports = {
  REPO,
  LATEST_API,
  LATEST_PAGE,
  parseVersion,
  compareVersions,
  summarizeNotes,
  isReleasePage,
  classifyHttp,
  statusResult,
  resultFromRelease,
};
