@echo off
rem The launcher works from any current directory, including paths with spaces.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-teams.ps1"
if errorlevel 1 pause
