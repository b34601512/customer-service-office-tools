const { appendLocalLogLine } = require("../../engine/logger");
const { isStructuredChildLogLine } = require("./structuredChildLogLine");
const { LOGIN_CONFIRM_PROMPT } = require("../../features/loginFlow");

function handleTaskProcessOutput(taskService, chunk, isError) {
  // 这里统一拆分子进程输出并同步到隐藏宿主、日志文件和网页，保证排障时只有一套真实日志源。
  const normalizedText = chunk.replace(/\r\n/g, "\n");
  const lines = normalizedText.split("\n").filter((line) => line.trim() !== "");
  // 输出管道可能把一句提示拆成多个 chunk；保留仅够识别提示的尾部，不缓存全部日志。
  const combined = (taskService.loginPromptTail || "") + normalizedText;
  const hasPrompt = combined.includes(LOGIN_CONFIRM_PROMPT);
  taskService.loginPromptTail = hasPrompt ? "" : combined.slice(-(LOGIN_CONFIRM_PROMPT.length - 1));

  for (const line of lines) {
    // 子任务 stderr 也是业务现场日志；统一转 stdout，避免隐藏启动器误判为控制台启动失败。
    console.log(line);
    if (!isStructuredChildLogLine(line)) {
      appendLocalLogLine(line);
    }

    taskService.state.appendLog(line);

    if (hasPrompt && taskService.state.currentTask?.status === "running" && taskService.state.currentTask.taskName === "login") {
      taskService.state.setTask({
        ...taskService.state.currentTask,
        awaitingConfirmation: true,
        message: "请在浏览器登录并进入聊天工作台，再点击“完成登录”；未进入工作台可以继续操作后再次确认。"
      });
    }
  }
}

module.exports = {
  handleTaskProcessOutput
};
