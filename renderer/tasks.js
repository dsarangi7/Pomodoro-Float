/* Daily task rules. Runs in the renderer and in Node's test runner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PomodoroTasks = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_TEXT = 80;
  const MAX_TASKS = 24;
  const KEEP_DAYS = 120;
  const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

  function isDayKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function formatDay(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function shiftDay(dayKey, deltaDays) {
    if (!isDayKey(dayKey)) return "";
    const [year, month, day] = dayKey.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + deltaDays);
    return formatDay(date);
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TEXT);
  }

  function coerceDays(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    if (input.days && typeof input.days === "object" && !Array.isArray(input.days)) {
      return input.days;
    }
    return input;
  }

  function sanitizeList(value) {
    const source = Array.isArray(value) ? value : Array.isArray(value?.tasks) ? value.tasks : [];
    const seen = new Set();
    const tasks = [];
    for (const item of source) {
      if (!item || typeof item !== "object") continue;
      const text = cleanText(item.text);
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!text || !ID_PATTERN.test(id) || seen.has(id)) continue;
      seen.add(id);
      tasks.push({ id, text, done: item.done === true });
      if (tasks.length >= MAX_TASKS) break;
    }
    return tasks;
  }

  function packDay(tasks) {
    return {
      tasks,
      completed: tasks.reduce((count, task) => count + (task.done ? 1 : 0), 0),
    };
  }

  function sanitizeStore(input, todayKey) {
    const source = coerceDays(input);
    const cutoff = isDayKey(todayKey) ? shiftDay(todayKey, -KEEP_DAYS) : "";
    const days = {};
    for (const [key, value] of Object.entries(source)) {
      if (!isDayKey(key) || (cutoff && key < cutoff)) continue;
      const tasks = sanitizeList(value);
      if (!tasks.length) continue;
      days[key] = packDay(tasks);
    }
    return { days };
  }

  function listFor(store, dayKey) {
    const day = store?.days?.[dayKey];
    const tasks = Array.isArray(day) ? day : day?.tasks;
    if (!Array.isArray(tasks)) return [];
    return tasks.map((task) => ({ id: task.id, text: task.text, done: task.done === true }));
  }

  function completedCount(tasks) {
    return tasks.reduce((count, task) => count + (task.done ? 1 : 0), 0);
  }

  function summary(tasks) {
    const total = tasks.length;
    const done = completedCount(tasks);
    if (total === 0) return "none yet";
    if (done === total) return `${done} done`;
    return `${done} of ${total} done`;
  }

  function writeDay(store, dayKey, tasks) {
    const days = { ...store.days };
    if (tasks.length) days[dayKey] = packDay(tasks);
    else delete days[dayKey];
    return { days };
  }

  function addTask(store, dayKey, text, id) {
    const clean = cleanText(text);
    const safeId = typeof id === "string" ? id.trim() : "";
    if (!clean || !isDayKey(dayKey) || !ID_PATTERN.test(safeId)) {
      return { store, task: null, full: false };
    }
    const tasks = listFor(store, dayKey);
    if (tasks.some((task) => task.id === safeId)) return { store, task: null, full: false };
    if (tasks.length >= MAX_TASKS) return { store, task: null, full: true };
    const task = { id: safeId, text: clean, done: false };
    return { store: writeDay(store, dayKey, [...tasks, task]), task, full: false };
  }

  function setTaskDone(store, dayKey, id, done) {
    const tasks = listFor(store, dayKey);
    const current = tasks.find((task) => task.id === id);
    if (!current || current.done === Boolean(done)) {
      return { store, task: current || null, changed: false };
    }
    const next = tasks.map((task) =>
      task.id === id ? { ...task, done: Boolean(done) } : task
    );
    const task = next.find((item) => item.id === id);
    return { store: writeDay(store, dayKey, next), task, changed: true };
  }

  function toggleTask(store, dayKey, id) {
    const current = listFor(store, dayKey).find((task) => task.id === id);
    if (!current) return { store, task: null, changed: false };
    return setTaskDone(store, dayKey, id, !current.done);
  }

  function removeTask(store, dayKey, id) {
    const tasks = listFor(store, dayKey);
    if (!tasks.some((task) => task.id === id)) return { store, removed: false };
    return { store: writeDay(store, dayKey, tasks.filter((task) => task.id !== id)), removed: true };
  }

  const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function partsOf(dayKey) {
    if (!isDayKey(dayKey)) return null;
    const [year, month, day] = dayKey.split("-").map(Number);
    return { year, month, day };
  }

  function shiftMonth(year, month, delta) {
    const date = new Date(year, month - 1 + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() + 1 };
  }

  function monthTitle(year, month) {
    return `${MONTH_NAMES[month - 1]} ${year}`;
  }

  function monthInRange(year, month, todayKey) {
    if (!isDayKey(todayKey)) return true;
    const today = partsOf(todayKey);
    if (year > today.year || (year === today.year && month > today.month)) return false;
    const cutoff = shiftDay(todayKey, -KEEP_DAYS);
    const oldest = partsOf(cutoff);
    if (year < oldest.year || (year === oldest.year && month < oldest.month)) return false;
    return true;
  }

  function canShiftMonth(year, month, delta, todayKey) {
    const next = shiftMonth(year, month, delta);
    return monthInRange(next.year, next.month, todayKey);
  }

  function buildMonth(year, month, todayKey, store) {
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let index = 0; index < firstWeekday; index += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = formatDay(new Date(year, month - 1, day));
      const tasks = listFor(store, key);
      const completed = completedCount(tasks);
      cells.push({
        key,
        day,
        isToday: key === todayKey,
        isFuture: Boolean(todayKey) && key > todayKey,
        total: tasks.length,
        completed,
      });
    }
    while (cells.length < 42) cells.push(null);
    return {
      year,
      month,
      title: monthTitle(year, month),
      weekdays: WEEKDAY_LABELS.slice(),
      cells,
    };
  }

  function dayLabel(dayKey, todayKey) {
    const parts = partsOf(dayKey);
    if (!parts) return "";
    const date = new Date(parts.year, parts.month - 1, parts.day);
    const name = DAY_NAMES[date.getDay()];
    const prefix = dayKey === todayKey ? "Today · " : "";
    return `${prefix}${name} ${parts.day}`;
  }

  function formatDayCopy(dayKey, tasks) {
    if (!isDayKey(dayKey)) return "";
    const lines = [dayKey];
    const list = Array.isArray(tasks) ? tasks : [];
    if (!list.length) {
      lines.push("No tasks recorded.");
      return lines.join("\n");
    }
    for (const task of list) {
      const text = cleanText(task?.text);
      if (!text) continue;
      lines.push(`${task.done === true ? "✓" : "○"} ${text}`);
    }
    if (lines.length === 1) lines.push("No tasks recorded.");
    return lines.join("\n");
  }

  return {
    MAX_TEXT,
    MAX_TASKS,
    KEEP_DAYS,
    isDayKey,
    shiftDay,
    cleanText,
    sanitizeStore,
    listFor,
    completedCount,
    summary,
    addTask,
    setTaskDone,
    toggleTask,
    removeTask,
    partsOf,
    shiftMonth,
    monthTitle,
    monthInRange,
    canShiftMonth,
    buildMonth,
    dayLabel,
    formatDayCopy,
    WEEKDAY_LABELS,
  };
});
