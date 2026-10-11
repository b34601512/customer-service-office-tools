' run-hidden.vbs -- start a PowerShell script with a hidden window (no black flash)
' Usage (Task Scheduler "Action"):
'   wscript.exe "C:\path\run-hidden.vbs" "C:\path\your-task.ps1"
' Or put this file next to a script named task.ps1 and pass no argument.
Option Explicit
Dim sh, fso, base, target
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count > 0 Then
    target = WScript.Arguments(0)
    If Not fso.FileExists(target) Then target = fso.BuildPath(base, WScript.Arguments(0))
Else
    target = fso.BuildPath(base, "task.ps1")
End If
sh.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & target & """", 0, False
