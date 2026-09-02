' Customer Service Timeout Supervisor - TUI Launcher
' Launches the terminal UI (TUI) control center in a visible console window.
' ASCII-only content to avoid code-page issues with any Windows locale.
Option Explicit

Dim shell
Dim fso
Dim scriptDir
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\scripts\tui-launcher.ps1"""

shell.CurrentDirectory = scriptDir
shell.Run command, 1, False

Set shell = Nothing
Set fso = Nothing
