' Silent start: this package's WeCom inbox daemon (no window).
' Pure ASCII on purpose: WSH chokes on non-ASCII text/arguments (tested: a vbs with a
' Chinese variable name saved as UTF-8 fails to compile and the autostart silently
' does nothing). The entry file is daemon_entry.mjs (ASCII name); keep Chinese inside
' the .mjs files only. Do NOT add non-ASCII characters to this file.
'
' How to use:
'   1. Keep this file next to daemon_entry.mjs and the daemon script (same folder).
'   2. Put a shortcut to this file into the Windows Startup folder (Win+R: shell:startup).
'   3. Double-click once to test: no window should appear; check the daemon log file.
'   4. Fill the credentials file in before the first run (see README step 1).
Dim sh, fso, baseDir, nodeExe, entry
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = baseDir
entry = baseDir & "\daemon_entry.mjs"
nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = """C:\Program Files\nodejs\node.exe"""
End If
sh.Run nodeExe & " """ & entry & """", 0, False
