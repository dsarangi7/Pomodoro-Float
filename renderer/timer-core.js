/* Shared timer rules. Runs in the renderer and in Node's test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PomodoroCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MODE_META = Object.freeze({
    focus: { label: "Focus", shortLabel: "Focus", accent: "#ff705c", settingKey: "focus" },
    short: { label: "Short break", shortLabel: "Short", accent: "#58d5a6", settingKey: "short" },
    long: { label: "Long break", shortLabel: "Long", accent: "#8fb3ff", settingKey: "long" },
  });

  const LIMITS = Object.freeze({
    focus: [1, 90],
    short: [1, 30],
    long: [1, 60],
    longEvery: [2, 8],
  });

  const DEFAULT_SETTINGS = Object.freeze({
    focus: 25,
    short: 5,
    long: 15,
    longEvery: 4,
    autoStartBreaks: false,
    autoStartFocus: false,
    sound: true,
    notifications: true,
    floatOnTop: true,
    launchAtLogin: false,
  });

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toInt(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function sanitizeSettings(input) {
    const source = input && typeof input === "object" ? input : {};
    const output = { ...DEFAULT_SETTINGS };
    for (const [key, [min, max]] of Object.entries(LIMITS)) {
      output[key] = clamp(toInt(source[key], DEFAULT_SETTINGS[key]), min, max);
    }
    for (const key of [
      "autoStartBreaks",
      "autoStartFocus",
      "sound",
      "notifications",
      "floatOnTop",
      "launchAtLogin",
    ]) {
      if (typeof source[key] === "boolean") output[key] = source[key];
    }
    return output;
  }

  function durationMs(settings, mode) {
    const key = MODE_META[mode] ? MODE_META[mode].settingKey : "focus";
    return clamp(toInt(settings[key], DEFAULT_SETTINGS[key]), LIMITS[key][0], LIMITS[key][1]) * 60_000;
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    const minutes = Math.round(safe / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }

  /**
   * Decide what follows a phase. focusInCycle is the number of focus rounds
   * already completed in this cycle, including the one that just finished.
   */
  function nextAfter(mode, focusInCycle, longEvery) {
    if (mode === "focus") {
      return focusInCycle >= longEvery
        ? { mode: "long", focusInCycle }
        : { mode: "short", focusInCycle };
    }
    if (mode === "long") {
      return { mode: "focus", focusInCycle: 0 };
    }
    return { mode: "focus", focusInCycle };
  }

  function progress(remainingMs, totalMs) {
    if (!totalMs || totalMs <= 0) return 0;
    return clamp(remainingMs / totalMs, 0, 1);
  }

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return {
    DEFAULT_SETTINGS,
    LIMITS,
    MODE_META,
    clamp,
    durationMs,
    formatClock,
    formatDuration,
    nextAfter,
    progress,
    sanitizeSettings,
    todayKey,
  };
});
