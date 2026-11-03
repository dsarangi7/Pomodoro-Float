const test = require("node:test");
const assert = require("node:assert/strict");
const tasks = require("../renderer/tasks.js");

test("task text is trimmed, collapsed, and capped", () => {
  assert.equal(tasks.cleanText("  write   notes  "), "write notes");
  assert.equal(tasks.cleanText("   "), "");
  assert.equal(tasks.cleanText("x".repeat(90)).length, tasks.MAX_TEXT);
});

test("add, toggle, and remove keep a per-day completed count", () => {
  let store = tasks.sanitizeStore(null, "2026-11-03");
  const added = tasks.addTask(store, "2026-11-03", "  Write notes ", "task1");
  assert.equal(added.task.text, "Write notes");
  assert.equal(added.task.done, false);
  store = added.store;
  store = tasks.addTask(store, "2026-11-03", "Reply", "task2").store;

  assert.equal(tasks.summary(tasks.listFor(store, "2026-11-03")), "0 of 2 done");
  const done = tasks.toggleTask(store, "2026-11-03", "task1");
  assert.equal(done.changed, true);
  assert.equal(done.task.done, true);
  store = done.store;
  assert.equal(store.days["2026-11-03"].completed, 1);
  assert.equal(tasks.summary(tasks.listFor(store, "2026-11-03")), "1 of 2 done");

  const again = tasks.setTaskDone(store, "2026-11-03", "task1", true);
  assert.equal(again.changed, false);

  store = tasks.toggleTask(store, "2026-11-03", "task2").store;
  assert.equal(store.days["2026-11-03"].completed, 2);
  assert.equal(tasks.summary(tasks.listFor(store, "2026-11-03")), "2 done");

  store = tasks.removeTask(store, "2026-11-03", "task1").store;
  assert.equal(store.days["2026-11-03"].tasks.length, 1);
  assert.equal(store.days["2026-11-03"].completed, 1);
  store = tasks.removeTask(store, "2026-11-03", "task2").store;
  assert.equal(store.days["2026-11-03"], undefined);
});

test("blank text and a full day do not add a task", () => {
  let store = { days: {} };
  const blank = tasks.addTask(store, "2026-11-03", "   ", "task1");
  assert.equal(blank.task, null);
  assert.equal(blank.full, false);

  for (let index = 0; index < tasks.MAX_TASKS; index += 1) {
    store = tasks.addTask(store, "2026-11-03", `Task ${index}`, `id${index}`).store;
  }
  const overflow = tasks.addTask(store, "2026-11-03", "One more", "overflow");
  assert.equal(overflow.task, null);
  assert.equal(overflow.full, true);
  assert.equal(tasks.listFor(overflow.store, "2026-11-03").length, tasks.MAX_TASKS);
});

test("loading keeps today, drops stale days, and repairs the completed count", () => {
  const tooOld = tasks.shiftDay("2026-11-03", -(tasks.KEEP_DAYS + 1));
  const kept = tasks.shiftDay("2026-11-03", -10);
  const stored = tasks.sanitizeStore(
    {
      days: {
        "2026-11-03": {
          tasks: [
            { id: "ok", text: "  Stretch  ", done: true },
            { id: "bad id", text: "Skip me", done: false },
            { id: "empty", text: "   ", done: false },
            { id: "ok", text: "Duplicate", done: false },
          ],
          completed: 9,
        },
        [kept]: {
          tasks: [{ id: "kept1", text: "Still here", done: false }],
          completed: 0,
        },
        [tooOld]: {
          tasks: [{ id: "old", text: "Too old", done: true }],
          completed: 1,
        },
        "not-a-day": {
          tasks: [{ id: "nope", text: "Nope", done: false }],
        },
      },
    },
    "2026-11-03"
  );

  assert.deepEqual(stored.days["2026-11-03"], {
    tasks: [{ id: "ok", text: "Stretch", done: true }],
    completed: 1,
  });
  assert.equal(stored.days[tooOld], undefined);
  assert.equal(stored.days[kept].tasks[0].text, "Still here");
  assert.equal(stored.days[kept].completed, 0);
  assert.equal(stored.days["not-a-day"], undefined);
  assert.equal(tasks.summary(tasks.listFor(stored, "2026-11-04")), "none yet");
  assert.equal(tasks.KEEP_DAYS, 120);
});

test("a month grid lists every day and marks today", () => {
  const store = {
    days: {
      "2026-11-03": {
        tasks: [
          { id: "a", text: "Outline", done: true },
          { id: "b", text: "Draft", done: false },
        ],
        completed: 1,
      },
      "2026-11-02": {
        tasks: [{ id: "c", text: "Notes", done: true }],
        completed: 1,
      },
    },
  };
  const month = tasks.buildMonth(2026, 11, "2026-11-03", store);
  assert.equal(month.title, "November 2026");
  assert.equal(month.cells.length, 42);
  assert.equal(month.cells[0].key, "2026-11-01");
  assert.equal(month.cells[0].day, 1);
  assert.equal(month.cells[2].isToday, true);
  assert.equal(month.cells[2].total, 2);
  assert.equal(month.cells[2].completed, 1);
  assert.equal(month.cells[1].completed, 1);
  assert.equal(month.cells[4].isFuture, true);
  assert.equal(tasks.dayLabel("2026-11-03", "2026-11-03"), "Today · Tuesday 3");
  assert.equal(tasks.canShiftMonth(2026, 11, 1, "2026-11-03"), false);
  assert.equal(tasks.canShiftMonth(2026, 11, -1, "2026-11-03"), true);
  assert.deepEqual(tasks.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  const cutoff = tasks.shiftDay("2026-11-03", -tasks.KEEP_DAYS);
  const oldest = tasks.partsOf(cutoff);
  assert.equal(tasks.canShiftMonth(oldest.year, oldest.month, -1, "2026-11-03"), false);
});

test("day copy text includes the date and marks finished work", () => {
  assert.equal(
    tasks.formatDayCopy("2026-11-03", [
      { id: "a", text: "  Done task one  ", done: true },
      { id: "b", text: "Done task two", done: true },
      { id: "c", text: "Open task three", done: false },
    ]),
    ["2026-11-03", "✓ Done task one", "✓ Done task two", "○ Open task three"].join("\n")
  );
  assert.equal(tasks.formatDayCopy("2026-11-04", []), "2026-11-04\nNo tasks recorded.");
  assert.equal(tasks.formatDayCopy("not-a-day", [{ text: "Nope", done: true }]), "");
});

test("day shift follows the local calendar", () => {
  assert.equal(tasks.shiftDay("2026-11-03", 1), "2026-11-04");
  assert.equal(tasks.shiftDay("2026-10-31", 1), "2026-11-01");
  assert.equal(tasks.shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(tasks.shiftDay("nope", 1), "");
});
