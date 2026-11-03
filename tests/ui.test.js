const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(ROOT, "renderer", "index.html"), "utf8").replace(
  /<script[^>]*><\/script>/g,
  ""
);
const CORE_SOURCE = fs.readFileSync(path.join(ROOT, "renderer", "timer-core.js"), "utf8");
const TASKS_SOURCE = fs.readFileSync(path.join(ROOT, "renderer", "tasks.js"), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(ROOT, "renderer", "app.js"), "utf8");

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime() {} },
      connect() {},
      start() {},
      stop() {},
    };
  }
  createGain() {
    return {
      gain: {
        setValueAtTime() {},
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    };
  }
}

function wait(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createApp(options = {}) {
  const dom = new JSDOM(HTML, {
    url: "https://pomodoro.test/?debug=1",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const calls = [];
  window.AudioContext = FakeAudioContext;
  window.pomodoro = {
    getWindowState: async () => ({ pinned: true, compact: false }),
    setCompact: async (value) => {
      calls.push(["compact", value]);
      return { compact: value };
    },
    setPinned: async (value) => {
      calls.push(["pin", value]);
      return value;
    },
    hide: () => calls.push(["hide"]),
    notify: (payload) => calls.push(["notify", payload]),
    updateTimer: (state) => calls.push(["timer", state]),
    getInfo: async () => ({ version: "1.2.1-test" }),
    checkForUpdates: async () =>
      options.updates || { state: "current", message: "You're up to date.", notes: "", url: "" },
    openUpdate: async () => {
      calls.push(["open-update"]);
      return options.openUpdate !== false;
    },
    setTasksOpen: async (value) => {
      calls.push(["tasks", value]);
      return { tasks: value };
    },
    setHistoryOpen: async (value) => {
      calls.push(["history", value]);
      return { history: value };
    },
    copyText: async (text) => {
      calls.push(["copy", text]);
      return true;
    },
    onCommand: () => () => {},
    onWindowState: () => () => {},
    onOpenSettings: () => () => {},
  };

  if (options.storage) {
    for (const [key, value] of Object.entries(options.storage)) {
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  }

  window.eval(CORE_SOURCE);
  window.eval(TASKS_SOURCE);
  window.eval(APP_SOURCE);
  await wait(60);
  return { dom, window, calls };
}

test("settings about names the developer and the feedback address", async () => {
  const { window } = await createApp();
  try {
    const about = window.document.querySelector(".about-note");
    assert.ok(about);
    assert.match(about.textContent, /Dibya/);
    assert.match(about.textContent, /dsarangi7/);
    const mail = about.querySelector('a[href="mailto:dsarangi7@gmail.com"]');
    assert.ok(mail);
    assert.equal(mail.textContent.trim(), "dsarangi7@gmail.com");
  } finally {
    window.close();
  }
});

test("check for updates reports a newer release and opens the download page", async () => {
  const { window, calls } = await createApp({
    updates: {
      state: "update",
      message: "v1.4.0 is available.",
      latestVersion: "1.4.0",
      notes: "Daily tasks stay on the card.",
      url: "https://github.com/dsarangi7/Pomodoro-Float/releases/tag/v1.4.0",
    },
  });
  try {
    await wait(40);
    const status = window.document.getElementById("updateStatus");
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /v1\.4\.0 is available/);
    assert.match(status.textContent, /Daily tasks stay on the card/);
    assert.equal(window.document.getElementById("updateAction").hidden, false);

    window.document.querySelector('[data-action="open-update"]').click();
    await wait(20);
    assert.ok(calls.some(([kind]) => kind === "open-update"));
  } finally {
    window.close();
  }
});

test("check for updates says when this version is current and when GitHub cannot be reached", async () => {
  const current = await createApp();
  try {
    const status = current.window.document.getElementById("updateStatus");
    assert.equal(status.hidden, true);
    current.window.document.querySelector('[data-action="check-updates"]').click();
    await wait(30);
    assert.equal(status.hidden, false);
    assert.match(status.textContent, /up to date/);
    assert.equal(current.window.document.getElementById("updateAction").hidden, true);
  } finally {
    current.window.close();
  }

  const offline = await createApp({
    updates: { state: "offline", message: "Couldn't reach GitHub. Try again.", notes: "", url: "" },
  });
  try {
    offline.window.document.querySelector('[data-action="check-updates"]').click();
    await wait(30);
    const status = offline.window.document.getElementById("updateStatus");
    assert.match(status.textContent, /Couldn't reach GitHub/);
    assert.equal(offline.window.document.getElementById("updateAction").hidden, true);
  } finally {
    offline.window.close();
  }
});

test("window renders the focus timer and starts/pauses from the big button", async () => {
  const { dom, window } = await createApp();
  try {
    assert.equal(window.document.getElementById("clock").textContent, "25:00");
    assert.equal(window.document.body.dataset.mode, "focus");
    assert.equal(window.document.getElementById("phaseLabel").textContent, "focus");
    assert.equal(window.document.getElementById("todayDuration").textContent, "0m");

    window.document.querySelector('[data-action="toggle"]').click();
    await wait(20);
    assert.equal(window.__pfDebug.snapshot().running, true);
    assert.equal(window.document.body.dataset.running, "true");
    assert.equal(window.document.getElementById("playButton").getAttribute("aria-label"), "Pause focus timer");

    window.document.querySelector('[data-action="toggle"]').click();
    await wait(20);
    assert.equal(window.__pfDebug.snapshot().running, false);
    assert.equal(window.document.body.dataset.running, "false");
  } finally {
    window.close();
  }
});

test("completing focus advances to a short break and records the session", async () => {
  const { dom, window, calls } = await createApp();
  try {
    window.document.querySelector('[data-action="toggle"]').click();
    window.__pfDebug.expire();
    await wait(20);

    const state = window.__pfDebug.snapshot();
    assert.equal(state.mode, "short");
    assert.equal(state.focusInCycle, 1);
    assert.equal(state.running, false);
    assert.equal(window.document.getElementById("clock").textContent, "05:00");
    assert.equal(window.document.getElementById("todaySessions").textContent, "1 round");
    assert.equal(window.document.getElementById("todayDuration").textContent, "25m");
    assert.equal(window.document.body.dataset.mode, "short");
    assert.ok(calls.some(([kind]) => kind === "notify"));
  } finally {
    window.close();
  }
});

test("four completed focus rounds produce a long break, then reset the cycle", async () => {
  const { dom, window } = await createApp();
  try {
    window.__pfDebug.switchMode("focus");
    for (let round = 1; round <= 4; round += 1) {
      window.__pfDebug.switchMode("focus");
      window.__pfDebug.expire();
      await wait(15);
      const state = window.__pfDebug.snapshot();
      assert.equal(state.focusInCycle, round);
      if (round < 4) assert.equal(state.mode, "short");
      else assert.equal(state.mode, "long");
    }

    assert.equal(window.document.getElementById("clock").textContent, "15:00");
    assert.equal(window.document.getElementById("todaySessions").textContent, "4 rounds");
    assert.equal(
      [...window.document.querySelectorAll("#roundDots span")].filter((dot) =>
        dot.classList.contains("is-filled")
      ).length,
      4
    );

    window.__pfDebug.expire();
    await wait(20);
    const reset = window.__pfDebug.snapshot();
    assert.equal(reset.mode, "focus");
    assert.equal(reset.focusInCycle, 0);
    assert.equal(window.document.getElementById("clock").textContent, "25:00");
  } finally {
    window.close();
  }
});

test("settings change lengths and persist them", async () => {
  const { dom, window } = await createApp();
  try {
    window.document.querySelector('[data-action="settings"]').click();
    await wait(20);
    const widget = window.document.getElementById("widget");
    assert.equal(widget.classList.contains("settings-open"), true);

    window.document
      .querySelector('[data-setting-step="focus"][data-delta="1"]')
      .click();
    await wait(10);

    const state = window.__pfDebug.snapshot();
    assert.equal(state.settings.focus, 26);
    assert.equal(window.document.getElementById("tabFocus").textContent, "26");
    assert.equal(window.document.getElementById("clock").textContent, "26:00");
    const stored = JSON.parse(
      window.localStorage.getItem("pomodoro-float.settings.v1")
    );
    assert.equal(stored.focus, 26);

    window.document.querySelector('[data-action="close-settings"]').click();
    assert.equal(widget.classList.contains("settings-open"), false);
  } finally {
    window.close();
  }
});

test("mode tabs and skip work without recording a skipped round", async () => {
  const { dom, window } = await createApp();
  try {
    window.document.querySelector('[data-mode="short"]').click();
    await wait(20);
    let state = window.__pfDebug.snapshot();
    assert.equal(state.mode, "short");
    assert.equal(window.document.getElementById("clock").textContent, "05:00");
    assert.equal(window.document.body.dataset.mode, "short");

    window.document.querySelector('[data-action="skip"]').click();
    await wait(20);
    state = window.__pfDebug.snapshot();
    assert.equal(state.mode, "focus");
    assert.equal(state.focusInCycle, 0);
    assert.equal(state.stats[Object.keys(state.stats)[0]]?.sessions || 0, 0);
  } finally {
    window.close();
  }
});

test("the pin control updates the float indicator", async () => {
  const { dom, window, calls } = await createApp();
  try {
    assert.equal(window.document.getElementById("floatText").textContent, "floating");
    window.document.querySelector('[data-action="pin"]').click();
    await wait(20);
    assert.ok(calls.some(([kind, value]) => kind === "pin" && value === false));
    assert.equal(window.document.getElementById("floatText").textContent, "on desktop");
    assert.equal(window.document.getElementById("floatToggle").checked, false);
  } finally {
    window.close();
  }
});

test("auto-start breaks rolls into the next phase", async () => {
  const { dom, window } = await createApp();
  try {
    window.document.getElementById("autoBreaks").click();
    window.document.querySelector('[data-action="toggle"]').click();
    window.__pfDebug.expire();
    await wait(1650);
    const state = window.__pfDebug.snapshot();
    assert.equal(state.mode, "short");
    assert.equal(state.running, true);
    assert.equal(window.document.body.dataset.running, "true");
  } finally {
    window.close();
  }
});

test("compact mode switches the view and asks the window to resize", async () => {
  const { dom, window, calls } = await createApp();
  try {
    window.document.querySelector('[data-action="compact"]').click();
    await wait(30);
    assert.equal(window.document.body.dataset.view, "compact");
    assert.ok(calls.some(([kind, value]) => kind === "compact" && value === true));

    window.document.querySelector('[data-action="expand"]').click();
    await wait(30);
    assert.equal(window.document.body.dataset.view, "full");
  } finally {
    window.close();
  }
});

test("an expired running timer is completed on launch", async () => {
  const now = Date.now();
  const { dom, window } = await createApp({
    storage: {
      "pomodoro-float.timer.v1": {
        mode: "focus",
        focusInCycle: 2,
        totalMs: 25 * 60_000,
        remainingMs: 0,
        running: true,
        deadline: now - 60_000,
      },
    },
  });
  try {
    await wait(900);
    const state = window.__pfDebug.snapshot();
    assert.equal(state.mode, "short");
    assert.equal(state.focusInCycle, 3);
    assert.equal(state.stats[Object.keys(state.stats)[0]].sessions, 1);
    assert.equal(state.running, false);
  } finally {
    window.close();
  }
});

async function addTask(window, text) {
  const input = window.document.getElementById("taskInput");
  input.value = text;
  input.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
  );
  await wait(15);
}

test("tasks can be added, checked, and saved for the local day", async () => {
  const { window, calls } = await createApp();
  try {
    const toggle = window.document.getElementById("tasksToggle");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(window.document.getElementById("taskCount").textContent, "none yet");

    toggle.click();
    await wait(20);
    assert.equal(window.document.body.dataset.tasks, "open");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.ok(calls.some(([kind, value]) => kind === "tasks" && value === true));
    assert.equal(window.document.activeElement, window.document.getElementById("taskInput"));

    await addTask(window, "  Write the notes  ");
    let rows = window.document.querySelectorAll(".task-row");
    assert.equal(rows.length, 1);
    assert.equal(window.document.querySelector(".task-text").textContent, "Write the notes");
    assert.equal(window.document.getElementById("taskInput").value, "");

    const today = window.PomodoroCore.todayKey();
    let stored = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(stored.days[today].tasks.length, 1);
    assert.equal(stored.days[today].tasks[0].done, false);
    assert.equal(stored.days[today].completed, 0);

    window.document.querySelector(".task-check").click();
    await wait(15);
    stored = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(stored.days[today].tasks[0].done, true);
    assert.equal(stored.days[today].completed, 1);
    assert.equal(window.document.querySelector(".task-row").classList.contains("is-done"), true);
    assert.equal(window.document.getElementById("taskCount").textContent, "1 done");
    assert.equal(window.__pfDebug.snapshot().running, false);

    window.document.getElementById("taskInput").value = "Reply to mail";
    window.document.getElementById("taskAdd").click();
    await wait(15);
    rows = window.document.querySelectorAll(".task-row");
    assert.equal(rows.length, 2);
    assert.equal(window.document.getElementById("taskCount").textContent, "1 of 2 done");

    const openBox = window.document.querySelector(".task-row:not(.is-done) .task-check");
    openBox.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      })
    );
    await wait(15);
    assert.equal(window.__pfDebug.snapshot().running, false);
    assert.equal(window.__pfDebug.snapshot().tasks.filter((task) => task.done).length, 2);
    assert.equal(window.document.getElementById("taskCount").textContent, "2 done");

    window.document.querySelector(".task-remove").click();
    await wait(15);
    assert.equal(window.document.querySelectorAll(".task-row").length, 1);
    stored = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(stored.days[today].tasks.length, 1);
    assert.equal(stored.days[today].completed, 1);
  } finally {
    window.close();
  }
});

test("today's tasks restore, and a new local day starts a fresh list", async () => {
  const tasks = require("../renderer/tasks.js");
  const core = require("../renderer/timer-core.js");
  const today = core.todayKey();
  const recent = tasks.shiftDay(today, -2);
  const ancient = tasks.shiftDay(today, -130);
  const { window } = await createApp({
    storage: {
      "pomodoro-float.tasks.v1": {
        days: {
          [today]: {
            tasks: [{ id: "keep1", text: "Stretch", done: true }],
            completed: 1,
          },
          [recent]: {
            tasks: [{ id: "recent1", text: "Yesterday's note", done: true }],
            completed: 1,
          },
          [ancient]: {
            tasks: [{ id: "ancient1", text: "Ancient", done: false }],
            completed: 0,
          },
        },
      },
    },
  });
  try {
    const labels = [...window.document.querySelectorAll(".task-text")].map((node) => node.textContent);
    assert.deepEqual(labels, ["Stretch"]);
    assert.equal(window.document.querySelector(".task-check").checked, true);
    assert.equal(window.document.getElementById("taskCount").textContent, "1 done");

    const stored = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(stored.days[ancient], undefined);
    assert.equal(stored.days[recent].tasks[0].text, "Yesterday's note");
    assert.equal(stored.days[recent].completed, 1);

    assert.equal(window.__pfDebug.rollDay(), true);
    assert.equal(window.document.querySelectorAll(".task-row").length, 0);
    assert.equal(window.document.getElementById("taskCount").textContent, "none yet");
    assert.equal(window.document.getElementById("taskEmpty").hidden, false);
    const rolled = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(rolled.days[today].completed, 1);
    assert.equal(rolled.days[window.__pfDebug.snapshot().taskDay], undefined);
  } finally {
    window.close();
  }
});

test("history keeps earlier days and shows that day's task list", async () => {
  const tasks = require("../renderer/tasks.js");
  const core = require("../renderer/timer-core.js");
  const today = core.todayKey();
  const earlier = tasks.shiftDay(today, -1);
  const { window, calls } = await createApp({
    storage: {
      "pomodoro-float.tasks.v1": {
        days: {
          [today]: {
            tasks: [{ id: "t1", text: "Today thing", done: false }],
            completed: 0,
          },
          [earlier]: {
            tasks: [
              { id: "y1", text: "Write the brief", done: true },
              { id: "y2", text: "Leave the draft", done: false },
            ],
            completed: 1,
          },
        },
      },
    },
  });
  try {
    window.document.querySelector('[data-action="history"]').click();
    await wait(30);
    assert.equal(window.document.body.dataset.history, "open");
    assert.equal(window.document.getElementById("historySheet").hidden, false);
    assert.ok(calls.some(([kind, value]) => kind === "history" && value === true));
    assert.match(window.document.getElementById("historyTitle").textContent, /\d{4}/);

    let dayButton = window.document.querySelector(`[data-day="${earlier}"]`);
    if (!dayButton) {
      window.document.querySelector('[data-action="history-prev"]').click();
      await wait(15);
      dayButton = window.document.querySelector(`[data-day="${earlier}"]`);
    }
    assert.ok(dayButton);
    dayButton.click();
    await wait(15);

    const labels = [...window.document.querySelectorAll("#historyList .history-text")].map(
      (node) => node.textContent
    );
    assert.deepEqual(labels, ["Write the brief", "Leave the draft"]);
    assert.equal(window.document.getElementById("historyDayCount").textContent, "1 of 2 done");
    const boxes = [...window.document.querySelectorAll("#historyList .history-check")];
    assert.equal(boxes.length, 2);
    assert.equal(boxes.every((box) => box.disabled), true);
    assert.equal(boxes[0].checked, true);
    assert.equal(boxes[1].checked, false);
    assert.equal(window.document.querySelector("#taskList .task-text").textContent, "Today thing");

    window.document.getElementById("historyCopy").click();
    await wait(20);
    const copied = calls.find(([kind]) => kind === "copy");
    assert.equal(
      copied[1],
      tasks.formatDayCopy(earlier, [
        { text: "Write the brief", done: true },
        { text: "Leave the draft", done: false },
      ])
    );
    assert.equal(window.document.getElementById("historyCopy").textContent, "Copied");

    assert.equal(window.__pfDebug.rollDay(), true);
    const stored = JSON.parse(window.localStorage.getItem("pomodoro-float.tasks.v1"));
    assert.equal(stored.days[today].tasks[0].text, "Today thing");
    assert.equal(stored.days[earlier].tasks.length, 2);
    assert.equal(stored.days[earlier].completed, 1);
    assert.equal(window.document.querySelectorAll("#taskList .task-row").length, 0);
  } finally {
    window.close();
  }
});

test("the task field does not take the timer shortcuts, and S still opens settings", async () => {
  const { window } = await createApp();
  try {
    window.document.getElementById("tasksToggle").click();
    await wait(20);
    const input = window.document.getElementById("taskInput");
    input.focus();
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true })
    );
    input.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key: " ",
        code: "Space",
        bubbles: true,
        cancelable: true,
      })
    );
    assert.equal(window.document.getElementById("widget").classList.contains("settings-open"), false);
    assert.equal(window.__pfDebug.snapshot().running, false);

    window.document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "s", bubbles: true, cancelable: true })
    );
    await wait(20);
    assert.equal(window.document.getElementById("widget").classList.contains("settings-open"), true);
  } finally {
    window.close();
  }
});

test("reset stats requires a second click", async () => {
  const { dom, window } = await createApp({
    storage: {
      "pomodoro-float.stats.v1": {
        [new Date().toISOString().slice(0, 10)]: { sessions: 3, seconds: 4500 },
      },
    },
  });
  try {
    window.document.querySelector('[data-action="settings"]').click();
    const reset = window.document.getElementById("resetStats");
    reset.click();
    assert.equal(reset.textContent, "Click to confirm");
    assert.equal(window.__pfDebug.snapshot().stats[Object.keys(window.__pfDebug.snapshot().stats)[0]].sessions, 3);
    reset.click();
    await wait(20);
    const stats = window.__pfDebug.snapshot().stats;
    const today = stats[Object.keys(stats)[0]];
    assert.equal(today.sessions, 0);
    assert.equal(window.document.getElementById("todaySessions").textContent, "0 rounds");
  } finally {
    window.close();
  }
});
