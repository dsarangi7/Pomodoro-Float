@echo off
setlocal EnableExtensions
rem Start Pomodoro Float with a quoted path and a working directory that
rem has no spaces. PomodoroFloat.exe then starts electron.exe from an
rem 8.3 path or a temporary drive letter when this folder still contains
rem spaces. Opening electron.exe directly can still hit STATUS_BREAKPOINT.
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON_NO_ATTACH_CONSOLE="
set "SAFE_CWD=%SystemRoot%"
if not defined SAFE_CWD set "SAFE_CWD=%WINDIR%"
if not defined SAFE_CWD set "SAFE_CWD=C:\Windows"
set "LAUNCH=%~dp0PomodoroFloat.exe"
if not exist "%LAUNCH%" goto :missing_exe
for %%I in ("%LAUNCH%") do set "SHORT=%%~sI"
echo.%SHORT%| findstr /c:" " >nul
if errorlevel 1 set "LAUNCH=%SHORT%"
start "" /D "%SAFE_CWD%" "%LAUNCH%"
exit /b 0

:missing_exe
echo PomodoroFloat.exe was not found next to this script.
echo Keep the whole folder together. If Windows showed SmartScreen,
echo choose More info, then Run anyway.
pause
exit /b 1
