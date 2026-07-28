@echo off
setlocal
REM PATH entry for FPM / system terminals. Script lives in ..\bin.
where node >nul 2>nul
if errorlevel 1 (
  echo [jen-cli] Node.js 未安装或不在 PATH 中。请安装 Node.js 18+ 后重试。 1>&2
  exit /b 1
)
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%..\bin\jen-cli.mjs" %*
