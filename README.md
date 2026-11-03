# Pomodoro Float

A calm, always-on-top Pomodoro timer for Windows. It lives as a small floating
card above your other windows, then folds into a compact pill when you want it
out of the way.

## Download for Windows

Get the latest portable zip from
**[GitHub Releases](https://github.com/dsarangi7/Pomodoro-Float/releases/latest)**.

1. Download `Pomodoro-Float-<version>-win64.zip` from the latest release.
2. Unzip it. Keep the `PomodoroFloat` folder on a path without spaces, such as `C:\PomodoroFloat`.
3. Run `PomodoroFloat.exe`. Do not run `electron.exe`.

This build is **unsigned**. If SmartScreen appears, choose **More info**, then **Run anyway**.

The app includes **daily tasks**, a month **History** calendar, and a **Copy** button that copies the selected day's tasks.

The zip also includes `Unblock and Launch.cmd`. The first time, you can run that instead: it clears the downloaded-from-the-internet mark, then starts `PomodoroFloat.exe`.

### Share the install helper

Share this repo link with colleagues, plus the installer scripts in `scripts/`:

https://github.com/dsarangi7/Pomodoro-Float

- [`scripts/Install-PomodoroFloat.ps1`](scripts/Install-PomodoroFloat.ps1)
- [`scripts/Install-PomodoroFloat.cmd`](scripts/Install-PomodoroFloat.cmd)

The helper downloads the latest GitHub Release zip, extracts it to `%LOCALAPPDATA%\PomodoroFloat`, and creates or updates a Desktop shortcut to `PomodoroFloat.exe`.

From a clone of this repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-PomodoroFloat.ps1
```

Or double-click `scripts\Install-PomodoroFloat.cmd`.

A user name with a space makes `%LOCALAPPDATA%\PomodoroFloat` a spaced path. `PomodoroFloat.exe` is a small launcher that starts the runtime from a space-free path. A manual unzip is still happiest at `C:\PomodoroFloat`.

## What it does

- **Focus / short break / long break** cycles with automatic long breaks every
  four rounds.
- **Always-on-top floating window** with a compact mode and tray controls.
- **Drift-free clock** based on wall time, so pausing, sleeping, or hiding the
  app does not make the timer lose seconds.
- **Auto-start** for breaks and focus rounds if you want a hands-off rhythm.
- **Daily stats** for focused minutes and completed rounds, saved locally.
- **Today's task list**: short tasks for the local day, ticked when done. The
  list is collapsed under the timer until you open it. A new calendar day
  starts a fresh editable list and keeps earlier days.
- **Task history**: open History on the task row (or Task history in
  settings) for a month calendar. Pick a day to see that day's tasks, done
  and not done, with a short count. Past days are read-only. **Copy** puts
  that day on the clipboard: the date, then each task with ✓ if it was
  finished and ○ if it was still open. Days are kept for 120 days, then
  dropped.
- **Soft chime and system notifications** at phase changes.
- **Persistent state** across restarts, including an in-flight timer.
- **Keyboard shortcuts**:
  - `Space` — start / pause
  - `R` — reset the current phase
  - `C` — compact / expand
  - `S` — settings
  - `P` — toggle always-on-top
  - `Esc` — close settings, history, or the task list
  - `Enter` — add a task from the task field
- **Global shortcuts**:
  - `Ctrl+Alt+Space` — start / pause
  - `Ctrl+Alt+R` — reset
  - `Ctrl+Alt+F` — show / hide

Closing the window hides it to the tray so the timer keeps running. Right-click
the tomato tray icon to start, pause, reset, skip a phase, or quit.

## Run the portable build

1. Extract `Pomodoro-Float-1.2.1-win64.zip`. The folder inside the zip is
   `PomodoroFloat` (no spaces).
2. Keep the whole folder together.
3. The first time, double-click `Unblock and Launch.cmd`.
4. After that, double-click `PomodoroFloat.exe`.
5. If you launch from a terminal that has Electron-specific variables set, use
   `Launch-PomodoroFloat.cmd` instead.

Do not double-click `electron.exe`. That file is the runtime. The launcher is
`PomodoroFloat.exe`.

The app has no installer and no network access. Settings, stats, and the daily
task list live in `%APPDATA%\Pomodoro Float`.

## Paths with spaces

Electron can close immediately with **STATUS_BREAKPOINT** (`0x80000003`) when
a parent folder contains a space, such as `G:\AI_WORKSPACE\pomodoro float\...`.
The same build runs when every directory in the path is space-free, for
example `C:\PomodoroFloat`. A space in the exe filename alone is not the
problem. This is separate from SmartScreen.

`PomodoroFloat.exe` is a small launcher. It starts `electron.exe` with a
quoted path, a working directory that has no spaces (`%SystemRoot%`), and an
image path that has no spaces: the Windows 8.3 short name when one exists,
otherwise a temporary drive letter mapped to this folder. `npm start` does the
same kind of relaunch if the checkout itself sits in a spaced directory.

Prefer keeping the folder on a path without spaces, such as
`C:\PomodoroFloat`, if the app still exits immediately. That remains the
reliable setup if no drive letter is free, or if `electron.exe` is opened
directly.

## Windows SmartScreen

This portable build is **unsigned**. Windows does not trust it the way it
trusts a signed installer, so SmartScreen may say it **cannot be reached** or
that the file could not run. That is the usual prompt for an unsigned download.
It does not mean the folder is incomplete, and it is not the space-path crash
above.

To open the app:

1. Unzip the whole folder and leave the files together.
2. Double-click **Unblock and Launch.cmd**. It removes the
   "downloaded from the internet" mark (`Unblock-File`) from the folder, then
   starts `PomodoroFloat.exe`. The window also leaves the next step on screen.
3. If a blue SmartScreen window still appears, choose **More info**, then
   **Run anyway**.
4. You can do the same by hand: right-click `PomodoroFloat.exe` →
   **Properties** → tick **Unblock** next to Security → OK, then launch the exe.

`Launch-PomodoroFloat.cmd` clears Electron's node-mode variable and starts the
launcher with a space-free working directory. Use that from a developer
terminal. For a downloaded copy, use **Unblock and Launch.cmd** the first time.

These steps get you past the prompt. They do **not** turn SmartScreen off.
Silencing it completely needs a code-signing certificate from a trusted
authority, which this project does not include.

## Develop

Requires Node.js 20+.

```powershell
npm install
npm start
```

`npm start` uses the bundled `runtime39` folder when present. If you need to
download the runtime again:

```powershell
node scripts/fetch-electron.mjs 39.8.10
```

Then extract the downloaded zip into `runtime39`.

## Test

```powershell
npm test
```

That runs the timer rules, the daily task rules, the jsdom UI tests, and a
check that the portable build stamps the exe and ships the unblock launcher.

The UI tests exercise the real renderer: start/pause, phase transitions,
long-break cycles, persistence, settings, compact mode, stats, and the task
list (add, tick, save, and the next local day).

## Build the portable app

```powershell
npm run build
```

The build script stages the app, packs it into `resources/app.asar`, combines it
with the Electron runtime, stamps the executable icon and version metadata
(`ProductName`, `CompanyName`, `FileDescription`, `FileVersion`), and writes a
zip to `dist/`. The zip folder is `PomodoroFloat` and includes
`PomodoroFloat.exe` plus `Unblock and Launch.cmd`.

You do not need a signing certificate to build or run the portable folder.
Signing would be a separate step if you want SmartScreen to stop warning.

## Release build

Pushing a version tag such as `v1.2.1` runs
[`.github/workflows/windows-portable.yml`](.github/workflows/windows-portable.yml)
on `windows-latest`. The workflow runs `npm test` and `npm run build`, uploads
`dist/Pomodoro-Float-<version>-win64.zip` as an Actions artifact, and attaches
that zip to the matching GitHub Release. You can also start the same build
with **workflow_dispatch**; a zip is attached to a release only when the run
is for a version tag. The upload uses `GITHUB_TOKEN`.

## Layout

```
main.js                 Electron main process, tray, shortcuts, window state
win-launch.js           Windows relaunch when the exe directory contains spaces
preload.js              Minimal context-isolated bridge
renderer/index.html     Widget markup
renderer/styles.css     Visual design and responsive compact mode
renderer/app.js         Timer state machine, tasks, and UI behavior
renderer/timer-core.js  Pure timer rules, shared with tests
renderer/tasks.js       Daily task rules, shared with tests
scripts/                Runtime fetching, portable build, unblock launcher
tests/                  Timer, task, UI, and build-metadata tests
```
