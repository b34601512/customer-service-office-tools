' Silent start: this project's WeCom long-connection daemon (no window).
' Pure ASCII on purpose: the folder path is derived at runtime, and the entry file
' is daemon_entry.cjs (ASCII name) so WSH never has to parse non-ASCII text.
' Why: a sibling project used a Chinese variable name and saved the file as UTF-8,
' which makes cscript/wscript fail with "invalid character" and the autostart
' silently does nothing. Do not put non-ASCII characters in this file.
Dim sh, fso, baseDir, nodeExe, entry
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = baseDir
entry = baseDir & "\daemon_entry.cjs"
nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = """C:\Program Files\nodejs\node.exe"""
End If
sh.Run nodeExe & " """ & entry & """", 0, False
