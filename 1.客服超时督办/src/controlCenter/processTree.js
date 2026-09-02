const { spawn } = require("child_process");
const { log } = require("../engine/logger");
const { processExistsByPid } = require("../engine/processPid");

function isProcessMissingTaskkillOutput(outputText) {
  // Windows 不同语言和编码下提示不一致，所以文本只做快速判断，最终仍以 PID 复核为准。
  const normalizedText = String(outputText || "").toLowerCase();
  return (
    normalizedText.includes("该进程不存在") ||
    normalizedText.includes("没有此任务的实例") ||
    normalizedText.includes("not found") ||
    normalizedText.includes("no running instance")
  );
}

function killProcessTree(pid) {
  // 这里统一调用 Windows 的 taskkill 终止整棵进程树，避免后台浏览器或子任务残留孤儿进程。
  return new Promise((resolve, reject) => {
    log("主线:停止", "网页控制台", "终止进程树", `调用 taskkill 终止 PID=${pid} 的进程树`);
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let errorText = "";
    let outputText = "";
    killer.stdout.setEncoding("utf8");
    killer.stdout.on("data", (chunk) => {
      outputText += String(chunk);
    });
    killer.stderr.setEncoding("utf8");
    killer.stderr.on("data", (chunk) => {
      errorText += String(chunk);
    });

    killer.on("error", (error) => {
      reject(new Error(`终止进程树失败：${error.message}`));
    });

    killer.on("exit", (code) => {
      const taskkillOutputText = `${errorText}\n${outputText}`.trim();
      if (code === 0 || isProcessMissingTaskkillOutput(taskkillOutputText) || !processExistsByPid(pid)) {
        resolve();
        return;
      }

      reject(new Error(`终止进程树失败：${taskkillOutputText || `taskkill 退出码=${code}`}`));
    });
  });
}

module.exports = {
  killProcessTree,
  isProcessMissingTaskkillOutput,
  processExistsByPid
};
