(() => {
  "use strict";

  const core = window.PomodoroCore;
  const tasksApi = window.PomodoroTasks;
  if (!core) throw new Error("PomodoroCore failed to load");
  if (!tasksApi) throw new Error("PomodoroTasks failed to load");

  const KEYS = {
    settings: "pomodoro-float.settings.v1",
    stats: "pomodoro-float.stats.v1",
    timer: "pomodoro-float.timer.v1",
    tasks: "pomodoro-float.tasks.v1",
  };
  const DEBUG = new URLSearchParams(window.location.search).has("debug");
  const MODE_ORDER = ["focus", "short", "long"];
  const AUTO_START_DELAY = 1500;

  const bridge = window.pomodoro || {
    getWindowState: async () => ({ pinned: true, compact: false }),
    setCompact: async () => ({}),
    setPinned: async (value) => Boolean(value),
    hide: () => {},
    notify: () => {},
    updateTimer: () => {},
    getInfo: async () => ({ version: "1.2.1" }),
    setTasksOpen: async (value) => Boolean(value),
    setHistoryOpen: async (value) => Boolean(value),
    copyText: async () => true,
    onCommand: () => () => {},
    onWindowState: () => () => {},
    onOpenSettings: () => () => {},
  };

  const el = {};
  for (const id of [
    "widget",
    "brandState",
    "pinButton",
    "settingsButton",
    "ring",
    "ringProgress",
    "phaseLabel",
    "clock",
    "roundLabel",
    "tabFocus",
    "tabShort",
    "tabLong",
    "focusState",
    "playButton",
    "todayDuration",
    "todaySessions",
    "roundDots",
    "floatState",
    "floatText",
    "compactPlay",
    "compactProgress",
    "compactTime",
    "compactPhase",
    "settingsSheet",
    "setFocus",
    "setShort",
    "setLong",
    "setLongEvery",
    "autoBreaks",
    "autoFocus",
    "soundToggle",
    "notifyToggle",
    "floatToggle",
    "versionLabel",
    "resetStats",
    "toast",
    "liveRegion",
    "tasksToggle",
    "taskCount",
    "tasksPanel",
    "taskForm",
    "taskInput",
    "taskEmpty",
    "taskList",
    "historySheet",
    "historyTitle",
    "historyPrev",
    "historyNext",
    "historyGrid",
    "historyDayLabel",
    "historyDayCount",
    "historyCopy",
    "historyEmpty",
    "historyList",
    "historyClose",
  ]) {
    el[id] = document.getElementById(id);
  }

  const modeButtons = [...document.querySelectorAll(".mode-tab")];
  const toggleButtons = [...document.querySelectorAll('[data-action="toggle"]')];

  let settings = core.sanitizeSettings(readJSON(KEYS.settings, {}));
  let stats = loadStats();
  let nowProvider = () => new Date();
  let taskDay = core.todayKey(nowProvider());
  let taskStore = loadTasks();
  let taskSerial = 0;
  let tasksOpen = false;
  let historyOpen = false;
  let historyMonth = null;
  let historyDay = "";
  let copyResetTimer = null;
  let mode = "focus";
  let focusInCycle = 0;
  let totalMs = core.durationMs(settings, mode);
  let remainingMs = totalMs;
  let running = false;
  let deadline = 0;
  let ticker = null;
  let autoStartTimer = null;
  let toastTimer = null;
  let celebrateTimer = null;
  let resetConfirmTimer = null;
  let saveInterval = null;
  let lastTrayKey = "";
  let completing = false;
  let settingsOpen = false;
  let compact = false;
  let pinned = true;
  let lastSettingsFocus = null;
  let audioContext = null;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Persistence is a convenience, not a requirement. */
    }
  }

  function loadStats() {
    const stored = readJSON(KEYS.stats, {});
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffKey = core.todayKey(cutoff);
    const cleaned = {};
    for (const [key, day] of Object.entries(stored)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoffKey) continue;
      cleaned[key] = {
        sessions: Math.max(0, Math.round(Number(day?.sessions) || 0)),
        seconds: Math.max(0, Math.round(Number(day?.seconds) || 0)),
      };
    }
    return cleaned;
  }

  function getDayStats() {
    const key = core.todayKey();
    if (!stats[key]) stats[key] = { sessions: 0, seconds: 0 };
    return stats[key];
  }

  function persistSettings() {
    writeJSON(KEYS.settings, settings);
  }

  function persistStats() {
    writeJSON(KEYS.stats, stats);
  }

  function loadTasks() {
    const stored = tasksApi.sanitizeStore(readJSON(KEYS.tasks, null), taskDay);
    writeJSON(KEYS.tasks, stored);
    return stored;
  }

  function persistTasks() {
    writeJSON(KEYS.tasks, taskStore);
  }

  function currentTasks() {
    return tasksApi.listFor(taskStore, taskDay);
  }

  function newTaskId() {
    taskSerial += 1;
    const time = nowProvider().getTime().toString(36);
    return `t${time}${taskSerial.toString(36)}`.slice(0, 40);
  }

  function syncTaskDay() {
    const key = core.todayKey(nowProvider());
    if (key === taskDay) return null;
    const previousCount = currentTasks().length;
    taskDay = key;
    taskStore = tasksApi.sanitizeStore(taskStore, key);
    persistTasks();
    return { previousCount };
  }

  function persistTimer() {
    writeJSON(KEYS.timer, {
      mode,
      focusInCycle,
      totalMs,
      remainingMs: running ? Math.max(0, deadline - Date.now()) : remainingMs,
      running,
      deadline: running ? deadline : null,
      savedAt: Date.now(),
    });
  }

  function restoreTimer() {
    const saved = readJSON(KEYS.timer, null);
    if (!saved || typeof saved !== "object") return false;
    if (MODE_ORDER.includes(saved.mode)) mode = saved.mode;
    focusInCycle = core.clamp(
      Math.round(Number(saved.focusInCycle) || 0),
      0,
      settings.longEvery
    );
    totalMs = core.clamp(
      Math.round(Number(saved.totalMs) || core.durationMs(settings, mode)),
      1_000,
      100 * 60_000
    );

    if (saved.running && Number.isFinite(Number(saved.deadline))) {
      const left = Number(saved.deadline) - Date.now();
      if (left > 250) {
        deadline = Number(saved.deadline);
        remainingMs = Math.min(left, totalMs);
        running = true;
        return false;
      }
      remainingMs = 0;
      return true; // expired while the app was away
    }

    const savedRemaining = Number(saved.remainingMs);
    remainingMs = Number.isFinite(savedRemaining) && savedRemaining > 0
      ? Math.min(savedRemaining, totalMs)
      : totalMs;
    return false;
  }

  function syncTray(force = false) {
    const display = core.formatClock(remainingMs);
    const key = `${display}|${mode}|${running}`;
    if (!force && key === lastTrayKey) return;
    lastTrayKey = key;
    bridge.updateTimer({ display, mode, running });
  }

  function announce(message) {
    el.liveRegion.textContent = "";
    window.setTimeout(() => {
      el.liveRegion.textContent = message;
    }, 40);
  }

  function showToast(message, duration = 2200) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => {
      el.toast.classList.remove("is-visible");
    }, duration);
  }

  function ensureAudio() {
    if (!settings.sound) return null;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
    return audioContext;
  }

  function playChime(completedMode) {
    if (!settings.sound) return;
    const context = ensureAudio();
    if (!context) return;
    const notes = completedMode === "focus" ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    const start = context.currentTime + 0.03;
    notes.forEach((frequency, index) => {
      const at = start + index * 0.13;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.105, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.62);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.65);
    });
  }

  function notifyCompletion(completedMode, nextMode) {
    if (!settings.notifications) return;
    let title = "Focus complete";
    let body;
    if (completedMode === "focus") {
      body =
        nextMode === "long"
          ? `Four rounds done. Take a ${settings.long}-minute long break.`
          : `Nice work. Take a ${settings.short}-minute break.`;
    } else {
      title = "Break complete";
      body = `Ready for round ${Math.min(focusInCycle + 1, settings.longEvery)} of ${settings.longEvery}?`;
    }
    bridge.notify({ title, body });
  }

  function celebrate() {
    window.clearTimeout(celebrateTimer);
    el.widget.classList.remove("celebrating");
    void el.widget.offsetWidth;
    el.widget.classList.add("celebrating");
    celebrateTimer = window.setTimeout(() => {
      el.widget.classList.remove("celebrating");
    }, 1300);
  }

  function renderRoundDots() {
    if (el.roundDots.children.length !== settings.longEvery) {
      el.roundDots.replaceChildren();
      for (let index = 0; index < settings.longEvery; index += 1) {
        el.roundDots.appendChild(document.createElement("span"));
      }
    }
    const crowded = settings.longEvery > 4;
    el.roundDots.style.gap = crowded ? "3px" : "";
    const dots = [...el.roundDots.children];
    const currentIndex =
      mode === "focus" && focusInCycle < settings.longEvery ? focusInCycle : -1;
    dots.forEach((dot, index) => {
      dot.classList.toggle("is-filled", index < focusInCycle);
      dot.classList.toggle("is-current", index === currentIndex);
      dot.style.width = crowded ? "10px" : "";
    });
  }

  function renderToday() {
    const day = getDayStats();
    el.todayDuration.textContent = core.formatDuration(day.seconds);
    el.todaySessions.textContent = `${day.sessions} ${day.sessions === 1 ? "round" : "rounds"}`;
    renderRoundDots();
  }

  function renderTaskRow(task) {
    const item = document.createElement("li");
    item.className = task.done ? "task-row is-done" : "task-row";

    const label = document.createElement("label");
    label.className = "task-check-label";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "task-check";
    box.dataset.taskId = task.id;
    box.checked = task.done;
    box.setAttribute("aria-label", task.done ? `Mark not done: ${task.text}` : `Mark done: ${task.text}`);

    const text = document.createElement("span");
    text.className = "task-text";
    text.textContent = task.text;

    label.append(box, text);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "task-remove";
    remove.dataset.action = "remove-task";
    remove.dataset.taskId = task.id;
    remove.setAttribute("aria-label", `Remove ${task.text}`);
    remove.title = "Remove";
    remove.textContent = "×";

    item.append(label, remove);
    return item;
  }

  function renderTasks() {
    const tasks = currentTasks();
    const active = document.activeElement;
    const activeId = active?.dataset?.taskId || "";
    const activeClass = active?.classList?.contains("task-remove") ? "task-remove" : "task-check";
    const done = tasksApi.completedCount(tasks);

    el.taskCount.textContent = tasksApi.summary(tasks);
    el.taskCount.classList.toggle("is-clear", tasks.length > 0 && done === tasks.length);
    el.taskEmpty.hidden = tasks.length !== 0;
    el.taskList.replaceChildren(...tasks.map(renderTaskRow));

    if (!activeId || active === el.taskInput) return;
    const next = el.taskList.querySelector(`.${activeClass}[data-task-id="${activeId}"]`);
    if (next && typeof next.focus === "function") next.focus({ preventScroll: true });
  }

  function commitTask() {
    const result = tasksApi.addTask(taskStore, taskDay, el.taskInput.value, newTaskId());
    if (!result.task) {
      if (result.full) showToast("Today's list is full", 1800);
      return;
    }
    taskStore = result.store;
    persistTasks();
    el.taskInput.value = "";
    renderTasks();
    announce(`Added ${result.task.text}.`);
  }

  function setTaskDone(id, done) {
    const result = tasksApi.setTaskDone(taskStore, taskDay, id, done);
    if (!result.changed) return;
    taskStore = result.store;
    persistTasks();
    renderTasks();
    announce(result.task.done ? `${result.task.text} done.` : `${result.task.text} marked not done.`);
  }

  function removeTask(id) {
    const existing = currentTasks().find((task) => task.id === id);
    const result = tasksApi.removeTask(taskStore, taskDay, id);
    if (!result.removed) return;
    taskStore = result.store;
    persistTasks();
    renderTasks();
    if (existing) announce(`Removed ${existing.text}.`);
  }

  async function setTasksOpen(value) {
    const next = Boolean(value);
    if (next === tasksOpen) return;
    if (next && settingsOpen) closeSettings();
    if (next && compact) await setCompact(false);
    tasksOpen = next;
    document.body.dataset.tasks = next ? "open" : "closed";
    el.tasksToggle.setAttribute("aria-expanded", String(next));
    el.tasksPanel.hidden = !next;
    try {
      await bridge.setTasksOpen(next);
    } catch {
      /* Window sizing is optional outside Electron. */
    }
    if (next) el.taskInput.focus({ preventScroll: true });
    else el.tasksToggle.focus({ preventScroll: true });
  }

  function resetCopyButton() {
    window.clearTimeout(copyResetTimer);
    copyResetTimer = null;
    el.historyCopy.textContent = "Copy";
    el.historyCopy.classList.remove("is-copied");
  }

  function renderHistoryDay(dayKey) {
    resetCopyButton();
    const tasks = tasksApi.listFor(taskStore, dayKey);
    const done = tasksApi.completedCount(tasks);
    el.historyDayLabel.textContent = tasksApi.dayLabel(dayKey, taskDay);
    el.historyDayCount.textContent = tasksApi.summary(tasks);
    el.historyDayCount.classList.toggle("is-clear", tasks.length > 0 && done === tasks.length);
    el.historyEmpty.hidden = tasks.length !== 0;
    el.historyList.replaceChildren(
      ...tasks.map((task) => {
        const item = document.createElement("li");
        item.className = task.done ? "history-row is-done" : "history-row";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.className = "history-check";
        box.checked = task.done;
        box.disabled = true;
        box.tabIndex = -1;
        box.setAttribute("aria-label", task.done ? `Done: ${task.text}` : `Not done: ${task.text}`);
        const text = document.createElement("span");
        text.className = "history-text";
        text.textContent = task.text;
        item.append(box, text);
        return item;
      })
    );
  }

  function renderHistory() {
    if (!historyMonth) {
      const parts = tasksApi.partsOf(taskDay);
      historyMonth = parts ? { year: parts.year, month: parts.month } : null;
    }
    if (!historyMonth) return;
    if (!historyDay) historyDay = taskDay;
    const month = tasksApi.buildMonth(historyMonth.year, historyMonth.month, taskDay, taskStore);
    const selectedInMonth = month.cells.some((cell) => cell && cell.key === historyDay);
    if (!selectedInMonth) {
      const fallback = [...month.cells].reverse().find((cell) => cell && !cell.isFuture);
      if (fallback) historyDay = fallback.key;
    }
    el.historyTitle.textContent = month.title;
    el.historyPrev.disabled = !tasksApi.canShiftMonth(historyMonth.year, historyMonth.month, -1, taskDay);
    el.historyNext.disabled = !tasksApi.canShiftMonth(historyMonth.year, historyMonth.month, 1, taskDay);
    el.historyGrid.replaceChildren(
      ...month.cells.map((cell) => {
        if (!cell) {
          const pad = document.createElement("span");
          pad.className = "history-pad";
          return pad;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className = "history-day-btn";
        if (cell.isToday) button.classList.add("is-today");
        if (cell.key === historyDay) button.classList.add("is-selected");
        if (cell.total > 0 && cell.completed === cell.total) button.classList.add("is-complete");
        button.dataset.day = cell.key;
        button.dataset.action = "history-day";
        button.disabled = cell.isFuture;
        button.setAttribute("aria-pressed", String(cell.key === historyDay));
        button.setAttribute(
          "aria-label",
          cell.total
            ? `${cell.key}, ${tasksApi.summary(tasksApi.listFor(taskStore, cell.key))}`
            : cell.key
        );
        const number = document.createElement("span");
        number.className = "history-day-num";
        number.textContent = String(cell.day);
        button.append(number);
        if (cell.total > 0) {
          const dot = document.createElement("span");
          dot.className = "history-dot";
          button.append(dot);
        }
        return button;
      })
    );
    renderHistoryDay(historyDay);
  }

  function stepHistoryMonth(delta) {
    if (!historyMonth) return;
    if (!tasksApi.canShiftMonth(historyMonth.year, historyMonth.month, delta, taskDay)) return;
    historyMonth = tasksApi.shiftMonth(historyMonth.year, historyMonth.month, delta);
    renderHistory();
  }

  async function setHistoryOpen(value) {
    const next = Boolean(value);
    if (next === historyOpen) return;
    if (next && settingsOpen) closeSettings();
    if (next && compact) await setCompact(false);
    historyOpen = next;
    document.body.dataset.history = next ? "open" : "closed";
    el.historySheet.hidden = !next;
    el.historySheet.setAttribute("aria-hidden", next ? "false" : "true");
    if (next) {
      const parts = tasksApi.partsOf(taskDay);
      historyMonth = parts ? { year: parts.year, month: parts.month } : historyMonth;
      if (!historyDay) historyDay = taskDay;
      renderHistory();
    }
    try {
      await bridge.setHistoryOpen(next);
    } catch {
      /* Window sizing is optional outside Electron. */
    }
    if (next) el.historyClose.focus({ preventScroll: true });
  }

  async function writeClipboard(text) {
    if (typeof bridge.copyText === "function") {
      await bridge.copyText(text);
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    throw new Error("clipboard unavailable");
  }

  async function copyHistoryDay() {
    const text = tasksApi.formatDayCopy(historyDay, tasksApi.listFor(taskStore, historyDay));
    if (!text) return;
    try {
      await writeClipboard(text);
    } catch {
      showToast("Couldn't copy that day", 1600);
      return;
    }
    el.historyCopy.textContent = "Copied";
    el.historyCopy.classList.add("is-copied");
    window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      el.historyCopy.textContent = "Copy";
      el.historyCopy.classList.remove("is-copied");
    }, 1500);
  }

  function statusText() {
    const active = core.MODE_META[mode];
    if (running) {
      if (mode === "focus") return "In focus. Stay with it.";
      if (mode === "short") return "Recovering. Step away for a moment.";
      return "Long break. Let your mind wander.";
    }
    if (remainingMs < totalMs - 500) return "Paused. Pick it back up.";
    if (mode === "short") return "A short breath, then back.";
    if (mode === "long") return "Take the long way back.";
    return "Ready when you are.";
  }

  function updateLabels() {
    const label = core.MODE_META[mode].label.toLowerCase();
    const action = running ? "Pause" : "Start";
    toggleButtons.forEach((button) => {
      button.setAttribute("aria-label", `${action} ${label} timer`);
      button.setAttribute("aria-pressed", String(running));
      button.title = `${action} ${label}`;
    });
  }

  function renderTimer() {
    const display = core.formatClock(remainingMs);
    const meta = core.MODE_META[mode];
    const ratio = core.progress(remainingMs, totalMs);
    const offset = (100 - ratio * 100).toFixed(3);

    document.body.dataset.mode = mode;
    document.body.dataset.running = String(running);

    el.ringProgress.style.strokeDashoffset = offset;
    el.compactProgress.style.strokeDashoffset = offset;
    el.clock.textContent = display;
    el.compactTime.textContent = display;
    el.phaseLabel.textContent = meta.label.toLowerCase();
    el.compactPhase.textContent =
      mode === "focus"
        ? `focus · round ${Math.min(focusInCycle + 1, settings.longEvery)}`
        : meta.label.toLowerCase();
    el.roundLabel.textContent =
      mode === "focus"
        ? `round ${Math.min(focusInCycle + 1, settings.longEvery)} of ${settings.longEvery}`
        : meta.label.toLowerCase();
    el.focusState.textContent = statusText();
    el.brandState.textContent = running
      ? "running"
      : remainingMs < totalMs - 500
        ? "paused"
        : "ready";

    modeButtons.forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });

    renderToday();
    updateLabels();
    syncTray();
    document.title = `${display} · ${meta.label} — Pomodoro Float`;
  }

  function renderSettings() {
    el.setFocus.textContent = settings.focus;
    el.setShort.textContent = settings.short;
    el.setLong.textContent = settings.long;
    el.setLongEvery.textContent = settings.longEvery;
    el.tabFocus.textContent = settings.focus;
    el.tabShort.textContent = settings.short;
    el.tabLong.textContent = settings.long;
    el.autoBreaks.checked = settings.autoStartBreaks;
    el.autoFocus.checked = settings.autoStartFocus;
    el.soundToggle.checked = settings.sound;
    el.notifyToggle.checked = settings.notifications;
    el.floatToggle.checked = pinned;
    renderFloatState();
    renderRoundDots();
  }

  function renderFloatState() {
    el.pinButton.classList.toggle("is-active", pinned);
    el.pinButton.setAttribute("aria-pressed", String(pinned));
    el.pinButton.title = pinned ? "Floating above windows" : "Keep above windows";
    el.floatToggle.checked = pinned;
    el.floatText.textContent = pinned ? "floating" : "on desktop";
    el.floatState.classList.toggle("is-unpinned", !pinned);
  }

  function startTicker() {
    stopTicker();
    ticker = window.setInterval(tick, 200);
    tick();
  }

  function stopTicker() {
    if (ticker) {
      window.clearInterval(ticker);
      ticker = null;
    }
  }

  function tick() {
    if (!running) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      remainingMs = 0;
      completePhase();
      return;
    }
    remainingMs = left;
    renderTimer();
  }

  function clearAutoStart() {
    if (autoStartTimer) {
      window.clearTimeout(autoStartTimer);
      autoStartTimer = null;
    }
  }

  function startTimer({ automatic = false } = {}) {
    if (running) return;
    clearAutoStart();
    if (remainingMs <= 0) {
      remainingMs = core.durationMs(settings, mode);
      totalMs = remainingMs;
    }
    ensureAudio();
    running = true;
    deadline = Date.now() + remainingMs;
    startTicker();
    persistTimer();
    renderTimer();
    syncTray(true);
    announce(`${core.MODE_META[mode].label} timer started${automatic ? " automatically" : ""}.`);
  }

  function pauseTimer() {
    if (!running) return;
    remainingMs = Math.max(1, deadline - Date.now());
    running = false;
    stopTicker();
    persistTimer();
    renderTimer();
    syncTray(true);
    announce("Timer paused.");
  }

  function toggleTimer() {
    ensureAudio();
    if (running) pauseTimer();
    else startTimer();
  }

  function resetTimer() {
    running = false;
    stopTicker();
    clearAutoStart();
    totalMs = core.durationMs(settings, mode);
    remainingMs = totalMs;
    persistTimer();
    renderTimer();
    syncTray(true);
    showToast("Timer reset", 1600);
    announce(`${core.MODE_META[mode].label} timer reset.`);
  }

  function switchMode(nextMode) {
    if (!MODE_ORDER.includes(nextMode) || nextMode === mode) return;
    running = false;
    stopTicker();
    clearAutoStart();
    mode = nextMode;
    if (mode === "focus" && focusInCycle >= settings.longEvery) focusInCycle = 0;
    totalMs = core.durationMs(settings, mode);
    remainingMs = totalMs;
    persistTimer();
    renderTimer();
    syncTray(true);
    showToast(`Switched to ${core.MODE_META[mode].label.toLowerCase()}`, 1700);
    announce(`${core.MODE_META[mode].label} selected.`);
  }

  function skipPhase() {
    const previous = mode;
    running = false;
    stopTicker();
    clearAutoStart();
    const next = core.nextAfter(previous, focusInCycle, settings.longEvery);
    mode = next.mode;
    focusInCycle = next.focusInCycle;
    totalMs = core.durationMs(settings, mode);
    remainingMs = totalMs;
    persistTimer();
    renderTimer();
    syncTray(true);
    showToast(`Skipped to ${core.MODE_META[mode].label.toLowerCase()}`, 1800);
    announce(`Skipped. ${core.MODE_META[mode].label} ready.`);
  }

  function scheduleAutoStart(completedMode) {
    clearAutoStart();
    const shouldStart =
      completedMode === "focus" ? settings.autoStartBreaks : settings.autoStartFocus;
    if (!shouldStart) return;
    autoStartTimer = window.setTimeout(() => {
      autoStartTimer = null;
      if (running) return;
      startTimer({ automatic: true });
    }, AUTO_START_DELAY);
  }

  function completePhase({ restored = false } = {}) {
    if (completing) return;
    completing = true;
    try {
      running = false;
      stopTicker();
      clearAutoStart();

      const completedMode = mode;
      const completedTotal = totalMs;

      if (completedMode === "focus") {
        const day = getDayStats();
        day.sessions += 1;
        day.seconds += Math.round(completedTotal / 1000);
        focusInCycle = Math.min(settings.longEvery, focusInCycle + 1);
        persistStats();
      }

      const next = core.nextAfter(completedMode, focusInCycle, settings.longEvery);
      mode = next.mode;
      focusInCycle = next.focusInCycle;
      totalMs = core.durationMs(settings, mode);
      remainingMs = totalMs;

      persistTimer();
      renderTimer();
      syncTray(true);
      celebrate();
      playChime(completedMode);
      notifyCompletion(completedMode, mode);

      const message =
        completedMode === "focus"
          ? mode === "long"
            ? "Four rounds done · take a long break"
            : "Focus complete · break time"
          : "Break over · ready to focus";
      showToast(message, 2800);
      announce(
        completedMode === "focus"
          ? `Focus complete. ${core.MODE_META[mode].label} ready.`
          : `Break complete. Ready for round ${Math.min(focusInCycle + 1, settings.longEvery)}.`
      );

      if (!restored) scheduleAutoStart(completedMode);
    } finally {
      completing = false;
    }
  }

  function stepSetting(key, delta) {
    const limits = core.LIMITS[key];
    if (!limits) return;
    const next = core.clamp(settings[key] + delta, limits[0], limits[1]);
    if (next === settings[key]) return;
    settings[key] = next;

    if (key === "longEvery") {
      focusInCycle = Math.min(focusInCycle, next);
    }

    if (MODE_ORDER.includes(key) && !running && mode === key) {
      totalMs = core.durationMs(settings, mode);
      remainingMs = totalMs;
    }

    persistSettings();
    renderSettings();
    renderTimer();
    persistTimer();
    ensureAudio();
  }

  function setBooleanSetting(key, value) {
    settings[key] = Boolean(value);
    persistSettings();
    if (key === "sound" && settings.sound) {
      ensureAudio();
      playChime("focus");
    }
  }

  async function togglePin(force) {
    const target = typeof force === "boolean" ? force : !pinned;
    if (target === pinned) return;
    try {
      const result = await bridge.setPinned(target);
      pinned = typeof result === "boolean" ? result : target;
    } catch {
      pinned = target;
    }
    settings.floatOnTop = pinned;
    persistSettings();
    renderFloatState();
    showToast(pinned ? "Floating above windows" : "Back on the desktop", 1600);
  }

  function applyPinned(value) {
    pinned = Boolean(value);
    settings.floatOnTop = pinned;
    renderFloatState();
  }

  async function setCompact(value) {
    const next = Boolean(value);
    if (next === compact) return;
    if (next && settingsOpen) closeSettings();
    compact = next;
    document.body.dataset.view = compact ? "compact" : "full";
    try {
      await bridge.setCompact(compact);
    } catch {
      /* The window manager can be unavailable during shutdown. */
    }
    if (compact) el.compactPlay.focus({ preventScroll: true });
    else el.playButton.focus({ preventScroll: true });
  }

  function openSettings() {
    if (compact) {
      setCompact(false).then(openSettings);
      return;
    }
    if (settingsOpen) return;
    if (historyOpen) setHistoryOpen(false);
    lastSettingsFocus = document.activeElement;
    settingsOpen = true;
    el.widget.classList.add("settings-open");
    el.settingsSheet.setAttribute("aria-hidden", "false");
    el.settingsButton.setAttribute("aria-expanded", "true");
    window.setTimeout(() => {
      const close = el.settingsSheet.querySelector('[data-action="close-settings"]');
      close?.focus({ preventScroll: true });
    }, 210);
  }

  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    el.widget.classList.remove("settings-open");
    el.settingsSheet.setAttribute("aria-hidden", "true");
    el.settingsButton.setAttribute("aria-expanded", "false");
    if (lastSettingsFocus && typeof lastSettingsFocus.focus === "function") {
      lastSettingsFocus.focus({ preventScroll: true });
    }
  }

  function resetStats() {
    if (!el.resetStats.classList.contains("is-confirming")) {
      el.resetStats.classList.add("is-confirming");
      el.resetStats.textContent = "Click to confirm";
      window.clearTimeout(resetConfirmTimer);
      resetConfirmTimer = window.setTimeout(() => {
        el.resetStats.classList.remove("is-confirming");
        el.resetStats.textContent = "Reset stats";
      }, 3500);
      return;
    }
    window.clearTimeout(resetConfirmTimer);
    el.resetStats.classList.remove("is-confirming");
    el.resetStats.textContent = "Reset stats";
    stats = {};
    persistStats();
    renderToday();
    showToast("Stats cleared for a fresh start", 2200);
  }

  function handleAction(action, source) {
    switch (action) {
      case "toggle":
        toggleTimer();
        break;
      case "reset":
        resetTimer();
        break;
      case "skip":
        skipPhase();
        break;
      case "pin":
        togglePin();
        break;
      case "settings":
        openSettings();
        break;
      case "close-settings":
        closeSettings();
        break;
      case "compact":
        setCompact(true);
        break;
      case "expand":
        setCompact(false);
        break;
      case "close":
        persistTimer();
        bridge.hide();
        break;
      case "tasks":
        setTasksOpen(!tasksOpen);
        break;
      case "history":
        setHistoryOpen(true);
        break;
      case "close-history":
        setHistoryOpen(false);
        break;
      case "history-prev":
        stepHistoryMonth(-1);
        break;
      case "history-next":
        stepHistoryMonth(1);
        break;
      case "history-day":
        historyDay = source?.dataset.day || historyDay;
        renderHistory();
        break;
      case "copy-day":
        copyHistoryDay();
        break;
      case "remove-task":
        removeTask(source?.dataset.taskId);
        break;
      default:
        break;
    }
  }

  function onKeyDown(event) {
    if (event.repeat) return;
    const tag = (event.target?.tagName || "").toLowerCase();
    const isFormControl = ["input", "textarea", "select"].includes(tag);

    if (event.key === "Escape") {
      if (settingsOpen) {
        event.preventDefault();
        closeSettings();
        return;
      }
      if (historyOpen) {
        event.preventDefault();
        setHistoryOpen(false);
        return;
      }
      if (tasksOpen) {
        event.preventDefault();
        setTasksOpen(false);
      }
      return;
    }

    if (isFormControl) return;
    if (settingsOpen || historyOpen) return;

    if (event.target.closest?.(".mode-tab")) {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const current = modeButtons.indexOf(event.target.closest(".mode-tab"));
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = (current + direction + modeButtons.length) % modeButtons.length;
        switchMode(modeButtons[next].dataset.mode);
        modeButtons[next].focus({ preventScroll: true });
        return;
      }
    }

    if (event.code === "Space") {
      if (tag === "button") return; // Let the focused button handle Space.
      event.preventDefault();
      toggleTimer();
      return;
    }
    if (tag === "button") return;

    const key = event.key.toLowerCase();
    if (key === "r") {
      event.preventDefault();
      resetTimer();
    } else if (key === "c") {
      event.preventDefault();
      setCompact(!compact);
    } else if (key === "s") {
      event.preventDefault();
      openSettings();
    } else if (key === "p") {
      event.preventDefault();
      togglePin();
    }
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        event.preventDefault();
        handleAction(actionButton.dataset.action, actionButton);
        return;
      }

      const modeButton = event.target.closest(".mode-tab");
      if (modeButton) {
        switchMode(modeButton.dataset.mode);
        return;
      }

      const stepButton = event.target.closest("[data-setting-step]");
      if (stepButton) {
        stepSetting(stepButton.dataset.settingStep, Number(stepButton.dataset.delta));
      }
    });

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", ensureAudio, { once: true });

    el.autoBreaks.addEventListener("change", (event) => {
      setBooleanSetting("autoStartBreaks", event.target.checked);
    });
    el.autoFocus.addEventListener("change", (event) => {
      setBooleanSetting("autoStartFocus", event.target.checked);
    });
    el.soundToggle.addEventListener("change", (event) => {
      setBooleanSetting("sound", event.target.checked);
    });
    el.notifyToggle.addEventListener("change", (event) => {
      setBooleanSetting("notifications", event.target.checked);
    });
    el.floatToggle.addEventListener("change", (event) => {
      togglePin(event.target.checked);
    });

    el.taskForm.addEventListener("submit", (event) => {
      event.preventDefault();
      commitTask();
    });
    el.taskInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (typeof el.taskForm.requestSubmit === "function") el.taskForm.requestSubmit();
      else commitTask();
    });
    el.taskList.addEventListener("change", (event) => {
      const box = event.target;
      if (!box || box.type !== "checkbox" || !box.classList.contains("task-check")) return;
      setTaskDone(box.dataset.taskId, box.checked);
    });
    el.taskList.addEventListener("keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      const box = event.target?.closest?.(".task-check");
      if (!box) return;
      event.preventDefault();
      const next = !box.checked;
      box.checked = next;
      setTaskDone(box.dataset.taskId, next);
    });

    el.resetStats.addEventListener("click", resetStats);
    el.settingsButton.setAttribute("aria-expanded", "false");
    el.settingsSheet.setAttribute("aria-hidden", "true");

    bridge.onCommand((command) => {
      if (command === "toggle") toggleTimer();
      else if (command === "reset") resetTimer();
      else if (command === "skip") skipPhase();
    });

    bridge.onWindowState((state) => {
      if (state && typeof state.pinned === "boolean") applyPinned(state.pinned);
      if (state && typeof state.compact === "boolean" && state.compact !== compact) {
        compact = state.compact;
        document.body.dataset.view = compact ? "compact" : "full";
      }
    });

    bridge.onOpenSettings(() => openSettings());
    window.addEventListener("beforeunload", persistTimer);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        persistTimer();
        return;
      }
      const rolled = syncTaskDay();
      if (rolled) {
        renderTasks();
        if (historyOpen) renderHistory();
        if (rolled.previousCount > 0) showToast("New day · fresh list", 2400);
      }
      renderToday();
    });
  }

  async function initialize() {
    const expired = restoreTimer();
    bindEvents();
    renderSettings();
    renderTimer();
    renderTasks();

    const preview = new URLSearchParams(window.location.search);
    if (preview.get("view") === "compact") {
      window.setTimeout(() => setCompact(true), 200);
    } else if (preview.get("settings") === "1") {
      window.setTimeout(openSettings, 350);
    } else if (preview.get("tasks") === "1") {
      window.setTimeout(() => setTasksOpen(true), 200);
    } else if (preview.get("history") === "1") {
      window.setTimeout(() => setHistoryOpen(true), 200);
    }

    try {
      const state = await bridge.getWindowState();
      if (state && typeof state.pinned === "boolean") applyPinned(state.pinned);
    } catch {
      /* Defaults are fine. */
    }

    try {
      const info = await bridge.getInfo();
      if (info?.version) el.versionLabel.textContent = `v${info.version}`;
    } catch {
      /* Keep the bundled version label. */
    }

    if (running) startTicker();
    syncTray(true);

    if (expired) {
      window.setTimeout(() => {
        if (running || remainingMs > 0) return;
        remainingMs = 0;
        completePhase({ restored: true });
      }, 700);
    }

    saveInterval = window.setInterval(() => {
      if (running) persistTimer();
    }, 20_000);
    window.setInterval(() => {
      const rolled = syncTaskDay();
      renderToday();
      if (!rolled) return;
      renderTasks();
      if (historyOpen) renderHistory();
      if (rolled.previousCount > 0) showToast("New day · fresh list", 2400);
      announce("New day. Today's task list is clear.");
    }, 60_000);
    window.addEventListener("pagehide", () => {
      if (saveInterval) window.clearInterval(saveInterval);
    });

    if (DEBUG) {
      window.__pfDebug = {
        snapshot: () => ({
          mode,
          focusInCycle,
          totalMs,
          remainingMs,
          running,
          settings: { ...settings },
          stats: JSON.parse(JSON.stringify(stats)),
          pinned,
          compact,
          settingsOpen,
          tasksOpen,
          historyOpen,
          historyDay,
          taskDay,
          tasks: currentTasks(),
          taskStore: JSON.parse(JSON.stringify(taskStore)),
        }),
        rollDay: () => {
          const nextKey = tasksApi.shiftDay(taskDay, 1);
          const [year, month, day] = nextKey.split("-").map(Number);
          const stamped = new Date(year, month - 1, day, 12, 0, 0);
          nowProvider = () => new Date(stamped.getTime());
          const rolled = syncTaskDay();
          renderTasks();
          renderToday();
          if (historyOpen) renderHistory();
          return Boolean(rolled);
        },
        expire: () => {
          if (!running) startTimer();
          deadline = Date.now() - 1;
          tick();
        },
        complete: () => completePhase(),
        switchMode,
        start: startTimer,
        pause: pauseTimer,
        reset: resetTimer,
        skip: skipPhase,
      };
    }
  }

  initialize().catch((error) => {
    console.error("Pomodoro Float failed to initialize:", error);
    document.body.dataset.running = "false";
  });
})();
