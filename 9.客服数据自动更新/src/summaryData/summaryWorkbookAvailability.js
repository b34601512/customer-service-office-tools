const fs = require("fs");
const { execFile } = require("child_process");

const exclusiveOpenCommand = [
  "$workbookPath = $env:CUSTOMER_SUMMARY_WORKBOOK_PATH",
  "$stream = [IO.File]::Open($workbookPath, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)",
  "$stream.Dispose()"
].join("; ");

function assertSummaryWorkbookWritable(workbookPath) {
  // 这个函数只在整轮开始前确认汇总表可被独占读写，不启动 WPS/Excel。
  const targetWorkbookPath = String(workbookPath || "").trim();
  if (!targetWorkbookPath) {
    return Promise.reject(new Error("没有配置新的客服数据总表。"));
  }
  if (!fs.existsSync(targetWorkbookPath)) {
    return Promise.reject(new Error(`汇总表不存在：${targetWorkbookPath}`));
  }
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", exclusiveOpenCommand],
      {
        windowsHide: true,
        timeout: 10000,
        env: {
          ...process.env,
          CUSTOMER_SUMMARY_WORKBOOK_PATH: targetWorkbookPath
        }
      },
      (error) => {
        if (!error) {
          resolve(true);
          return;
        }
        reject(new Error(`汇总表当前被占用，请先关闭 WPS/Excel：${targetWorkbookPath}`));
      }
    );
  });
}

module.exports = {
  assertSummaryWorkbookWritable
};
