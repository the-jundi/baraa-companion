@echo off
rem Starts the Baraa companion (overlay). Quit with Ctrl+Alt+Q or the tray icon.
rem Examples:  Start-Companion.cmd --film      (hide HUD + hints, for recording)
rem            Start-Companion.cmd --start=2   (jump to step 3)
cd /d "%~dp0"
start "" "node_modules\electron\dist\electron.exe" . %*
