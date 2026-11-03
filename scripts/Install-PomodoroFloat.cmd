@echo off
setlocal
title Install Pomodoro Float
cd /d "%~dp0"
echo.
echo  Pomodoro Float installer
echo  Downloads the latest Windows zip from GitHub Releases,
echo  extracts it to %%LOCALAPPDATA%%\PomodoroFloat, and updates
echo  the Desktop shortcut.
echo  Repo: https://github.com/dsarangi7/Pomodoro-Float
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-PomodoroFloat.ps1"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo  Install failed. Error code %ERR%.
) else (
  echo  Install finished. Open "Pomodoro Float" from the Desktop.
)
echo.
pause
exit /b %ERR%
