const childProcess = require("child_process");
const { log } = require("../../engine/logger");
const { attachTaskProcessEventHandlers } = require("./processEventHandlers");
const { buildTaskConfig } = require("./taskConfig");
const { handleTaskProcessOutput } = require("./processOutputHandler");
const { waitForProcessExit } = require("./processExitWaiter");

class ControlCenterTaskService {
  constructor(projectRoot, state, hooks = {}) {
    this.projectRoot = projectRoot;
    this.state = state;
    this.onTaskExit = typeof hooks.onTaskExit === "function" ? hooks.onTaskExit : null;
    this.currentProcess = null;
    this.pendingStopReason = null;
    this.currentTaskRunId = 0;
  }

  async startTask(taskName) {
    // 这里统一启动登录或督办任务，确保任意时刻只跑一条主线。
    if (this.currentProcess) {
      if (taskName === "start" && this.shouldTakeOverConfirmedLoginTask()) {
        await this.takeOverConfirmedLoginTaskBeforeStart();
      } else if (taskName === "start" && this.state.currentTask?.taskName === "login") {
        throw new Error("首次登录还没完成，请先点击“完成登录”，再启动后台督办。");
      } else {
        throw new Error("当前已有任务在运行，请先等待当前任务结束。");
      }
    }

    await require("../ensureProjectDependencies").ensureProjectDependencies(this.projectRoot);
    const taskConfig = buildTaskConfig(taskName, this.projectRoot);
    log(
      "主线:启动",
      "网页控制台",
      `任务:${taskConfig.windowLabel}`,
      `准备启动子进程，command=${taskConfig.command} args=${taskConfig.args.join(" ")} cwd=${this.projectRoot}`
    );

    const child = this.spawnTaskProcess(taskConfig);
    const taskState = this.buildRunningTaskState(taskName, taskConfig, child.pid);
    this.markTaskAsStarted(child, taskState);
    const taskRunId = this.currentTaskRunId;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.handleProcessOutput(String(chunk), false);
    });
    child.stderr.on("data", (chunk) => {
      this.handleProcessOutput(String(chunk), true);
    });

    attachTaskProcessEventHandlers(this, child, taskConfig, taskState, taskRunId, taskName);
  }

  spawnTaskProcess(taskConfig) {
    // 这里只负责创建子进程，失败时直接暴露底层错误原因。
    try {
      return childProcess.spawn(taskConfig.command, taskConfig.args, {
        cwd: this.projectRoot,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      log(
        "主线:失败",
        "网页控制台",
        `任务:${taskConfig.windowLabel}`,
        `子进程创建失败：${error.message}`
      );
      throw error;
    }
  }

  buildRunningTaskState(taskName, taskConfig, childPid) {
    // 这里统一生成运行中任务状态，避免启动流程里散落状态字段。
    return {
      taskName,
      label: taskConfig.windowLabel,
      startedAt: new Date().toISOString(),
      status: "running",
      awaitingConfirmation: false,
      message: taskConfig.successMessage,
      pid: childPid
    };
  }

  markTaskAsStarted(child, taskState) {
    // 这里统一记录当前子进程和网页状态，保证运行序号只在新任务启动时递增。
    this.currentProcess = child;
    this.currentTaskRunId += 1;
    this.pendingStopReason = null;
    this.state.setTask(taskState);
    log(
      "主线:完成",
      "网页控制台",
      `任务:${taskState.label}`,
      `子进程已启动，PID=${child.pid}`
    );
  }

  isCurrentProcess(child, taskRunId) {
    // 这里用进程对象和运行序号双重判断，避免旧任务异步退出污染新任务状态。
    return this.currentProcess === child && this.currentTaskRunId === taskRunId;
  }

  shouldTakeOverConfirmedLoginTask() {
    // 这里只允许后台启动接管“已完成确认后的首次登录任务”，等待用户确认时不能自动跳过。
    const currentTask = this.state.currentTask;
    return (
      Boolean(this.currentProcess) &&
      currentTask?.taskName === "login" &&
      currentTask.status === "running" &&
      currentTask.awaitingConfirmation === false
    );
  }

  async takeOverConfirmedLoginTaskBeforeStart() {
    // 这里在用户明确点击后台启动时收掉已确认的登录进程，后台任务会再次真实校验登录态。
    const loginProcess = this.currentProcess;
    const loginTask = this.state.currentTask;
    const stopReason = "首次登录已发送完成确认，后台启动将接管并重新校验登录态。";

    log(
      "主线:执行",
      "网页控制台",
      `任务:${loginTask.label}`,
      `后台启动接管首次登录任务，准备结束旧进程 PID=${loginProcess.pid}`
    );
    this.pendingStopReason = stopReason;
    this.state.setTask({
      ...loginTask,
      status: "stopping",
      message: "正在收尾首次登录，准备启动后台督办。"
    });

    const exitPromise = waitForProcessExit(loginProcess);
    await require("../processTree").killProcessTree(loginProcess.pid);
    await exitPromise;

    if (this.currentProcess === loginProcess) {
      this.currentProcess = null;
      this.currentTaskRunId += 1;
      this.pendingStopReason = null;
      this.state.setTask({
        ...loginTask,
        endedAt: new Date().toISOString(),
        status: "idle",
        awaitingConfirmation: false,
        message: "首次登录已收尾，正在启动后台督办。"
      });
    }
  }

  async stopCurrentTask() {
    // 这里统一停止当前后台任务，并强制结束整个进程树，避免内层 Node 进程残留。
    const currentTask = this.state.currentTask;
    if (!this.currentProcess || !currentTask) {
      throw new Error("当前没有可停止的任务。");
    }

    if (currentTask.taskName !== "start") {
      throw new Error("当前只有「后台督办」任务支持网页内停止。");
    }

    const stopMessage = `正在停止「${currentTask.label}」，请稍等几秒。`;
    log("主线:停止", "网页控制台", `任务:${currentTask.label}`, `准备停止进程树，PID=${this.currentProcess.pid}`);
    this.state.setTask({
      ...currentTask,
      status: "stopping",
      message: stopMessage
    });
    this.pendingStopReason = `任务「${currentTask.label}」已由网页控制台手动停止。`;

    try {
      await require("../processTree").killProcessTree(this.currentProcess.pid);
    } catch (error) {
      this.pendingStopReason = null;
      throw error;
    }
  }

  async shutdownAllRunningTasks() {
    // 这里统一给“彻底退出控制台”复用，保证无论当前跑的是登录还是后台督办，都先把子进程清干净。
    const currentTask = this.state.currentTask;
    if (!this.currentProcess || !currentTask) {
      return;
    }

    const stopMessage = `正在退出控制台，准备结束「${currentTask.label}」。`;
    log(
      "主线:停止",
      "网页控制台",
      `任务:${currentTask.label}`,
      `控制台准备退出，先清理子进程 PID=${this.currentProcess.pid}`
    );
    this.state.setTask({
      ...currentTask,
      status: "stopping",
      message: stopMessage
    });
    this.pendingStopReason = `任务「${currentTask.label}」已随控制台退出一起结束。`;
    await require("../processTree").killProcessTree(this.currentProcess.pid);
  }

  confirmLoginCompleted() {
    // 这里在网页按钮点击后把回车写回等待中的登录流程，支持首次登录和后台启动里的自动登录续跑。
    if (!this.currentProcess || !this.state.currentTask) {
      throw new Error("当前没有等待确认的登录任务。");
    }

    if (!this.state.currentTask.awaitingConfirmation) {
      throw new Error("当前登录流程还没进入确认阶段，请先在浏览器完成登录。");
    }

    const child = this.currentProcess;
    if (child.exitCode !== null && child.exitCode !== undefined) {
      this.currentProcess = null;
      throw new Error("登录流程已结束，无法再发送确认，请重新执行首次登录。");
    }

    const stdin = child.stdin;
    if (!stdin || stdin.destroyed) {
      throw new Error("登录流程输入通道已关闭，无法发送确认，请重新执行首次登录。");
    }

    // 这里给输入管道挂一次性错误监听，避免子进程刚退出时写回车触发未捕获 EPIPE 把整个控制台带崩。
    // 监听器在写入回调或管道关闭后再移除，确保异步错误事件始终有人接住。
    let removeWriteGuard = null;
    if (typeof stdin.once === "function" && typeof stdin.removeListener === "function") {
      const handleWriteError = (writeError) => {
        log(
          "主线:失败",
          "网页控制台",
          `任务:${this.state.currentTask?.label || ""}`,
          `发送登录确认失败：${writeError.message}`
        );
      };
      stdin.once("error", handleWriteError);
      removeWriteGuard = () => {
        stdin.removeListener("error", handleWriteError);
      };
      stdin.once("close", removeWriteGuard);
    }
    stdin.write("\n", removeWriteGuard || undefined);

    const nextMessage = this.state.currentTask.taskName === "start"
      ? "已发送登录完成确认，程序会在保存登录态后继续后台督办。"
      : "已发送登录完成确认，正在保存登录态。";
    this.state.setTask({
      ...this.state.currentTask,
      awaitingConfirmation: false,
      message: nextMessage
    });
    log("主线:执行", "网页控制台", `任务:${this.state.currentTask.label}`, "已发送登录完成确认");
  }

  handleProcessOutput(chunk, isError) {
    // 这里转交给日志处理器，任务类只负责提供当前状态上下文。
    handleTaskProcessOutput(this, chunk, isError);
  }
}

module.exports = {
  ControlCenterTaskService
};
