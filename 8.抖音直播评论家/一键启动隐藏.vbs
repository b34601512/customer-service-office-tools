Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = scriptDir
command = "pythonw.exe " & Chr(34) & scriptDir & "\app_entry.py" & Chr(34)
shell.Run command, 0, False
