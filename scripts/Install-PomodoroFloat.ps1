# Installs the latest Pomodoro Float Windows release.
#
# Downloads the portable zip from GitHub Releases for dsarangi7/Pomodoro-Float,
# extracts it to %LOCALAPPDATA%\PomodoroFloat, and creates or updates a
# Desktop shortcut to PomodoroFloat.exe.
#
# Usage (from this repo):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-PomodoroFloat.ps1
#
# Share this script together with the repo link:
#   https://github.com/dsarangi7/Pomodoro-Float

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'dsarangi7/Pomodoro-Float'
$InstallDir = Join-Path $env:LOCALAPPDATA 'PomodoroFloat'
$ExeName = 'PomodoroFloat.exe'

function Fail([string]$Message) {
  Write-Host ""
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

if ($env:OS -ne 'Windows_NT') {
  Fail 'This installer is for Windows. On Windows, run scripts\Install-PomodoroFloat.cmd or this script in PowerShell.'
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # PowerShell 7 already negotiates TLS 1.2.
}

Write-Host "Looking up the latest release of $Repo..."
$headers = @{
  'User-Agent' = 'PomodoroFloat-Install'
  'Accept' = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}

try {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers $headers
} catch {
  Fail "Could not read the latest GitHub Release ($($_.Exception.Message)). Check https://github.com/$Repo/releases and try again."
}

$asset = $null
if ($release.assets) {
  foreach ($candidate in @($release.assets)) {
    if ($candidate -and $candidate.name -like 'Pomodoro-Float-*-win64.zip') {
      $asset = $candidate
      break
    }
  }
}
if (-not $asset) {
  $tag = $release.tag_name
  Fail "Release $tag has no Windows zip yet. The GitHub Actions workflow attaches Pomodoro-Float-<version>-win64.zip when the build finishes. Wait for that run, then start this installer again. Releases: https://github.com/$Repo/releases"
}

$zipPath = Join-Path $env:TEMP $asset.name
$extractRoot = Join-Path $env:TEMP ("PomodoroFloat-extract-" + [guid]::NewGuid().ToString('N'))

Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)..."
try {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -UseBasicParsing
} catch {
  Fail "Download failed ($($_.Exception.Message))."
}

Write-Host "Extracting..."
New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
try {
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force
} catch {
  Fail "Could not unzip $($asset.name) ($($_.Exception.Message))."
}

$unpacked = Join-Path $extractRoot 'PomodoroFloat'
$unpackedExe = Join-Path $unpacked $ExeName
if (-not (Test-Path -LiteralPath $unpackedExe)) {
  Fail "The zip did not contain PomodoroFloat\$ExeName. Leave the release asset unchanged and try again."
}

Write-Host "Closing Pomodoro Float if this install folder is in use..."
try {
  $prefix = $InstallDir.TrimEnd('\') + '\'
  $running = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
  })
  foreach ($proc in $running) {
    Write-Host "  Stopping $($proc.Name) (pid $($proc.ProcessId))"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
  if ($running.Count -gt 0) {
    Start-Sleep -Seconds 1
  }
} catch {
  Write-Host "Could not check for a running copy. If the copy step fails, quit Pomodoro Float from the tray and run this again."
}

if (Test-Path -LiteralPath $InstallDir) {
  try {
    Remove-Item -LiteralPath $InstallDir -Recurse -Force
  } catch {
    Fail "Could not replace $InstallDir. Quit Pomodoro Float from the tray icon, then run this installer again. ($($_.Exception.Message))"
  }
}

New-Item -ItemType Directory -Path (Split-Path -Parent $InstallDir) -Force | Out-Null
# Copy rather than move so TEMP and LOCALAPPDATA can sit on different drives.
Copy-Item -LiteralPath $unpacked -Destination $InstallDir -Recurse -Force

$exePath = Join-Path $InstallDir $ExeName
if (-not (Test-Path -LiteralPath $exePath)) {
  Fail "Install folder is missing $ExeName after extract."
}

Write-Host "Clearing the downloaded-from-the-internet mark..."
Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

$desktop = [Environment]::GetFolderPath('Desktop')
if (-not $desktop) {
  Fail 'Could not find the Desktop folder.'
}
$shortcutPath = Join-Path $desktop 'Pomodoro Float.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $InstallDir
$shortcut.WindowStyle = 1
$shortcut.Description = 'Pomodoro Float'
$shortcut.IconLocation = "$exePath,0"
$shortcut.Save()

Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Installed Pomodoro Float $($release.tag_name) to:"
Write-Host "  $InstallDir"
Write-Host "Desktop shortcut:"
Write-Host "  $shortcutPath"
Write-Host ""
Write-Host "Start it from the Desktop shortcut or from PomodoroFloat.exe."
Write-Host "The build is unsigned. If SmartScreen appears, choose More info, then Run anyway."
exit 0
