const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../renderer/timer-core.js");

test("settings are clamped and bad input falls back to defaults", () => {
  const settings = core.sanitizeSettings({
    focus: 999,
    short: 0,
    long: -4,
    longEvery: 99,
    sound: "yes",
    notifications: false,
    unknown: true,
  });
  assert.equal(settings.focus, 90);
  assert.equal(settings.short, 1);
  assert.equal(settings.long, 1);
  assert.equal(settings.longEvery, 8);
  assert.equal(settings.sound, true);
  assert.equal(settings.notifications, false);
  assert.equal("unknown" in settings, false);
});

test("clock formatting rounds up and handles the final second", () => {
  assert.equal(core.formatClock(25 * 60_000), "25:00");
  assert.equal(core.formatClock(24 * 60_000 + 59_500), "25:00");
  assert.equal(core.formatClock(61_000), "01:01");
  assert.equal(core.formatClock(1), "00:01");
  assert.equal(core.formatClock(0), "00:00");
  assert.equal(core.formatClock(-500), "00:00");
  assert.equal(core.formatDuration(3_750), "1h 3m");
  assert.equal(core.formatDuration(60), "1m");
});

test("cycle moves through short and long breaks and resets after long", () => {
  assert.deepEqual(core.nextAfter("focus", 1, 4), { mode: "short", focusInCycle: 1 });
  assert.deepEqual(core.nextAfter("focus", 4, 4), { mode: "long", focusInCycle: 4 });
  assert.deepEqual(core.nextAfter("short", 2, 4), { mode: "focus", focusInCycle: 2 });
  assert.deepEqual(core.nextAfter("long", 4, 4), { mode: "focus", focusInCycle: 0 });
});

test("progress is clamped and safe for zero totals", () => {
  assert.equal(core.progress(500, 1000), 0.5);
  assert.equal(core.progress(2000, 1000), 1);
  assert.equal(core.progress(-2, 1000), 0);
  assert.equal(core.progress(1, 0), 0);
});

test("today key uses local calendar fields", () => {
  const local = new Date(2026, 9, 22, 0, 5, 0);
  assert.equal(core.todayKey(local), "2026-10-22");
});

test("duration and mode metadata stay in sync", () => {
  const settings = core.sanitizeSettings({ focus: 30, short: 7, long: 20 });
  assert.equal(core.durationMs(settings, "focus"), 1_800_000);
  assert.equal(core.durationMs(settings, "short"), 420_000);
  assert.equal(core.durationMs(settings, "long"), 1_200_000);
  assert.equal(core.MODE_META.focus.settingKey, "focus");
});
