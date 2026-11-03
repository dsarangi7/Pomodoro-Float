@echo off
setlocal EnableExtensions
title Pomodoro Float
echo.
echo  Pomodoro Float is an unsigned portable app.
echo  SmartScreen may say it cannot be reached, or that the file could not run.
echo.
echo  This window clears the "downloaded from the internet" mark on this
echo  folder, then starts PomodoroFloat.exe.
echo.
echo  If a blue SmartScreen window still appears:
echo      More info  -^>  Run anyway
echo.
echo  Or right-click PomodoroFloat.exe, open Properties, tick Unblock
echo  next to Security, then try again.
echo.
echo  Fully silencing SmartScreen needs a code-signing certificate.
echo  This build does not include one, and it does not bypass SmartScreen.
echo.
echo  A different failure: if a parent folder contains a space, Electron can
echo  close immediately with STATUS_BREAKPOINT. PomodoroFloat.exe avoids that
echo  by starting electron.exe from a space-free path. If it still closes,
echo  move this folder to a path without spaces, for example C:\PomodoroFloat.
echo  Do not start electron.exe directly.
echo.
echo  Unblocking files in this folder...

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath $env:ROOT -Recurse -File | Unblock-File"
if errorlevel 1 goto :unblock_failed

echo  Starting Pomodoro Float...
call "%~dp0Launch-PomodoroFloat.cmd"
echo.
echo  If SmartScreen is still showing, choose More info, then Run anyway.
echo  This window closes in a few seconds.
timeout /t 12 >nul
goto :eof

:unblock_failed
echo.
echo  Could not unblock automatically.
echo  Right-click PomodoroFloat.exe, open Properties, tick Unblock, then OK.
echo.
pause
exit /b 1
