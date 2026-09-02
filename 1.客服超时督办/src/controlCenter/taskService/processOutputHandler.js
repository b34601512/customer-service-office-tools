const { appendLocalLogLine } = require("../../engine/logger");
const { isStructuredChildLogLine } = require("./structuredChildLogLine");

function handleTaskProcessOutput(taskService, chunk, isError) {
  // 这里统一拆分子进程输出并同步到隐藏宿主、日志文件和网页，保证排障时只有一套真实日志源。
  const normalizedText = chunk.replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n").filter((line) => line.trim() !== "");

  for (const line of lines) {
    // 子任务 stderr 也是业务现场日志；统一转 stdout，避免隐藏启动器误判为控制台启动失败。
    console.log(line);
    if (!isStructuredChildLogLine(line)) {
      appendLocalLogLine(line);
    }

    taskService.state.appendLog(line);

    if (line.includes("请在浏览器中完成登录，完成后回到这里按回车继续")) {
      taskService.state.setTask({
        ...taskService.state.currentTask,
        awaitingConfirmation: true,
        message: "请先在程序打开的浏览器里完成登录，再点击“完成登录”。"
      });
    }
  }
}

module.exports = {
  handleTaskProcessOutput
};
