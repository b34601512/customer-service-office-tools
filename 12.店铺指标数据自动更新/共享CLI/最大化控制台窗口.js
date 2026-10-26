// 所有 Windows TUI/CLI 入口共用的窗口处理：启动后最大化当前控制台，
// 非 Windows 环境直接跳过，避免影响测试和跨平台命令行运行。
const { spawn } = require("node:child_process");

function 最大化当前控制台窗口() {
  if (process.platform !== "win32") return false;
  const 脚本 = [
    "Add-Type -Namespace Native -Name Window -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);';",
    "$handle = [Native.Window]::GetConsoleWindow();",
    "if ($handle -ne [IntPtr]::Zero) { [Native.Window]::ShowWindow($handle, 3) | Out-Null }",
  ].join(" ");
  try {
    const 子进程 = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", 脚本], {
      windowsHide: true,
      stdio: "ignore",
    });
    子进程.unref();
    return true;
  } catch {
    return false;
  }
}

module.exports = { 最大化当前控制台窗口 };
