' Customer Service Timeout Supervisor - legacy launcher (forwards to TUI)
' Prefer double-clicking 启动中心.bat in the project root.
Option Explicit

Dim shell
Dim fso
Dim scriptDir
Dim command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\tui-launcher.ps1"""

shell.CurrentDirectory = fso.GetParentFolderName(scriptDir)
shell.Run command, 1, False

Set shell = Nothing
Set fso = Nothing
