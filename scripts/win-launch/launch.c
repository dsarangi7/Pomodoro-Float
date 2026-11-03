/*
 * PomodoroFloat.exe
 *
 * Electron/Chromium can exit immediately with STATUS_BREAKPOINT (0x80000003)
 * when the executable directory contains spaces. Chrome's own install path is
 * quoted correctly; this portable layout is not always started that way, and
 * a parent folder such as "pomodoro float" is enough to trip the crash.
 *
 * This stub is the file users double-click. It is not Chromium. It starts
 * electron.exe with a space-free image path and working directory:
 *   1. the real path, when that directory has no spaces
 *   2. the Windows 8.3 short path, when one exists
 *   3. a temporary drive letter mapped at this folder (DefineDosDevice)
 *
 * Build (from the repo root, on a machine with MinGW-w64):
 *   x86_64-w64-mingw32-gcc -O2 -s -municode -mwindows -o scripts/win-launch/PomodoroFloat.exe scripts/win-launch/launch.c
 */

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>

#include <stdio.h>
#include <string.h>
#include <wchar.h>

#define PATH_CAP 1024
#define CMD_CAP 32768

static void fail(const wchar_t* message);

static int contains_space(const wchar_t* text) {
  for (; text && *text; text++) {
    if (*text == L' ' || *text == L'\t') return 1;
  }
  return 0;
}

static void dirname_of(wchar_t* path) {
  wchar_t* slash = wcsrchr(path, L'\\');
  wchar_t* alt = wcsrchr(path, L'/');
  if (!slash || (alt && alt > slash)) slash = alt;
  if (slash && slash != path) *slash = 0;
}

static int file_exists(const wchar_t* path) {
  DWORD attrs = GetFileAttributesW(path);
  return attrs != INVALID_FILE_ATTRIBUTES && (attrs & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

static void append_text(wchar_t* dest, size_t cap, const wchar_t* text) {
  size_t used = wcslen(dest);
  size_t add = wcslen(text);
  if (used + add + 1 >= cap) return;
  memcpy(dest + used, text, (add + 1) * sizeof(wchar_t));
}

/* CommandLineToArgvW quoting. The exe path we launch has no spaces, but
 * forwarded arguments might. */
static void append_arg(wchar_t* dest, size_t cap, const wchar_t* arg) {
  size_t used = wcslen(dest);
  int quote = (arg[0] == 0);
  const wchar_t* scan;
  int slashes = 0;

  for (scan = arg; *scan; scan++) {
    if (*scan == L' ' || *scan == L'\t' || *scan == L'"') quote = 1;
  }
  if (used && used + 1 < cap) dest[used++] = L' ';
  if (quote && used + 1 < cap) dest[used++] = L'"';
  dest[used] = 0;

  for (scan = arg; *scan; scan++) {
    if (*scan == L'\\') {
      slashes++;
      continue;
    }
    if (*scan == L'"') {
      int count;
      for (count = 0; count < slashes * 2 + 1; count++) append_text(dest, cap, L"\\");
      append_text(dest, cap, L"\"");
      slashes = 0;
      continue;
    }
    while (slashes-- > 0) append_text(dest, cap, L"\\");
    slashes = 0;
    wchar_t one[2] = {*scan, 0};
    append_text(dest, cap, one);
  }
  if (quote) {
    while (slashes-- > 0) {
      append_text(dest, cap, L"\\");
      append_text(dest, cap, L"\\");
    }
    append_text(dest, cap, L"\"");
  } else {
    while (slashes-- > 0) append_text(dest, cap, L"\\");
  }
}

static void clear_electron_env(void) {
  SetEnvironmentVariableW(L"ELECTRON_RUN_AS_NODE", NULL);
  SetEnvironmentVariableW(L"ELECTRON_NO_ATTACH_CONSOLE", NULL);
}

static DWORD launch_and_wait(const wchar_t* exe, const wchar_t* cwd, wchar_t* command) {
  STARTUPINFOW startup;
  PROCESS_INFORMATION process;
  DWORD code = 1;
  ZeroMemory(&startup, sizeof(startup));
  startup.cb = sizeof(startup);
  ZeroMemory(&process, sizeof(process));
  if (!CreateProcessW(exe, command, NULL, NULL, FALSE, 0, NULL, cwd, &startup, &process)) {
    wchar_t message[192];
    _snwprintf(
        message,
        192,
        L"Pomodoro Float could not start electron.exe (Windows error %lu).",
        GetLastError());
    fail(message);
    return 1;
  }
  WaitForSingleObject(process.hProcess, INFINITE);
  GetExitCodeProcess(process.hProcess, &code);
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return code;
}

static void build_command(wchar_t* command, size_t cap, const wchar_t* exe, int argc, wchar_t** argv) {
  int index;
  command[0] = 0;
  append_arg(command, cap, exe);
  for (index = 1; index < argc; index++) append_arg(command, cap, argv[index]);
}

static int drive_is_free(wchar_t letter) {
  wchar_t root[4] = {letter, L':', L'\\', 0};
  UINT type = GetDriveTypeW(root);
  return type == DRIVE_NO_ROOT_DIR || type == DRIVE_UNKNOWN;
}

static wchar_t map_directory(const wchar_t* dir, wchar_t* target, size_t target_cap) {
  wchar_t letter;
  _snwprintf(target, target_cap, L"\\??\\%s", dir);
  for (letter = L'Z'; letter >= L'D'; letter--) {
    wchar_t name[3] = {letter, L':', 0};
    if (!drive_is_free(letter)) continue;
    if (DefineDosDeviceW(DDD_RAW_TARGET_PATH, name, target)) return letter;
  }
  return 0;
}

static void unmap_directory(wchar_t letter, const wchar_t* target) {
  wchar_t name[3] = {letter, L':', 0};
  DWORD flags = DDD_REMOVE_DEFINITION | DDD_RAW_TARGET_PATH | DDD_EXACT_MATCH_ON_REMOVE;
  if (!DefineDosDeviceW(flags, name, target)) {
    DefineDosDeviceW(DDD_REMOVE_DEFINITION | DDD_RAW_TARGET_PATH, name, target);
  }
}

static void fail(const wchar_t* message) {
  MessageBoxW(NULL, message, L"Pomodoro Float", MB_ICONWARNING | MB_OK);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE prev, PWSTR cmdline, int show) {
  wchar_t self[PATH_CAP];
  wchar_t dir[PATH_CAP];
  wchar_t electron[PATH_CAP];
  wchar_t short_electron[PATH_CAP];
  wchar_t command[CMD_CAP];
  wchar_t map_target[PATH_CAP];
  DWORD length;
  int argc = 0;
  wchar_t** argv;
  (void)instance;
  (void)prev;
  (void)cmdline;
  (void)show;

  length = GetModuleFileNameW(NULL, self, PATH_CAP);
  if (length == 0 || length >= PATH_CAP) {
    fail(L"Pomodoro Float could not read its own path.");
    return 1;
  }
  wcscpy(dir, self);
  dirname_of(dir);
  _snwprintf(electron, PATH_CAP, L"%s\\electron.exe", dir);
  if (!file_exists(electron)) {
    fail(L"electron.exe is missing next to PomodoroFloat.exe. Keep the whole folder together, then start PomodoroFloat.exe.");
    return 1;
  }

  argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) argc = 0;
  clear_electron_env();

  if (!contains_space(dir)) {
    wchar_t cwd[PATH_CAP];
    wcscpy(cwd, dir);
    build_command(command, CMD_CAP, electron, argc, argv);
    if (argv) LocalFree(argv);
    return (int)launch_and_wait(electron, cwd, command);
  }

  length = GetShortPathNameW(electron, short_electron, PATH_CAP);
  if (length > 0 && length < PATH_CAP) {
    wchar_t short_dir[PATH_CAP];
    wcscpy(short_dir, short_electron);
    dirname_of(short_dir);
    if (!contains_space(short_dir) && file_exists(short_electron)) {
      build_command(command, CMD_CAP, short_electron, argc, argv);
      if (argv) LocalFree(argv);
      return (int)launch_and_wait(short_electron, short_dir, command);
    }
  }

  {
    wchar_t letter = map_directory(dir, map_target, PATH_CAP);
    wchar_t mapped_exe[32];
    wchar_t mapped_cwd[8];
    DWORD code;
    if (!letter) {
      if (argv) LocalFree(argv);
      fail(L"This folder's path contains spaces, and Pomodoro Float could not map a free drive letter. Move the folder to a path without spaces, for example C:\\PomodoroFloat, then start PomodoroFloat.exe again.");
      return 1;
    }
    _snwprintf(mapped_exe, 16, L"%c:\\electron.exe", letter);
    _snwprintf(mapped_cwd, 4, L"%c:\\", letter);
    if (!file_exists(mapped_exe)) {
      unmap_directory(letter, map_target);
      if (argv) LocalFree(argv);
      fail(L"Pomodoro Float mapped a drive letter but could not see electron.exe. Move the folder to a path without spaces, for example C:\\PomodoroFloat.");
      return 1;
    }
    build_command(command, CMD_CAP, mapped_exe, argc, argv);
    if (argv) LocalFree(argv);
    code = launch_and_wait(mapped_exe, mapped_cwd, command);
    unmap_directory(letter, map_target);
    return (int)code;
  }
}
