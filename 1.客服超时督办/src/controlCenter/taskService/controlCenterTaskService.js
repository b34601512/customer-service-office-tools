const childProcess = require("child_process");
const { log } = require("../../engine/logger");
const { attachTaskProcessEventHandlers } = require("./processEventHandlers");
const { buildTaskConfig } = require("./taskConfig");
const { handleTaskProcessOutput } = require("./processOutputHandler");

class ControlCenterTaskService {
  constructor(projectRoot, state, hooks = {}) {
    this.projectRoot = projectRoot;
    this.state = state;
    this.onTaskExit = typeof hooks.onTaskExit === "function" ? hooks.onTaskExit : null;
    this.currentProcess = null;
    this.pendingStopReason = null;
    this.currentTaskRunId = 0;
    this.starting = false;
  }

  async startTask(taskName) {
    // 这里统一启动登录或督办任务，确保任意时刻只跑一条主线。
    if (this.currentProcess || this.starting) {
      throw new Error("当前已有任务正在启动、运行或收尾，请等待结束或取消当前任务后再启动。");
    }
    this.starting = true;
    try {
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
      child.stdin?.on?.("error", (error) => {
        if (!this.isCurrentProcess(child, taskRunId)) return;
        log("主线:失败", "网页控制台", `任务:${taskConfig.windowLabel}`, `登录输入通道失败：${error.message}`);
        this.state.setTask({ ...this.state.currentTask, awaitingConfirmation: false,
          message: `登录确认通道已关闭：${error.message}。请取消任务后重新登录。` });
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (this.isCurrentProcess(child, taskRunId)) this.handleProcessOutput(String(chunk), false);
      });
      child.stderr.on("data", (chunk) => {
        if (this.isCurrentProcess(child, taskRunId)) this.handleProcessOutput(String(chunk), true);
      });

      attachTaskProcessEventHandlers(this, child, taskConfig, taskState, taskRunId, taskName);
    } finally {
      this.starting = false;
    }
  }

  spawnTaskProcess(taskConfig) {
    // 这里只负责创建子进程，失败时直接暴露底层错误原因。
    try {
      return childProcess.spawn(taskConfig.command, taskConfig.args, {
        cwd: this.projectRoot,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
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
    this.loginPromptTail = "";
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

  async stopCurrentTask() {
    // 这里统一停止当前后台任务，并强制结束整个进程树，避免内层 Node 进程残留。
    const currentTask = this.state.currentTask;
    if (!this.currentProcess || !currentTask) {
      throw new Error("当前没有可停止的任务。");
    }

    if (currentTask.status === "stopping") return;
    const child = this.currentProcess;

    const stopMessage = `正在停止「${currentTask.label}」，请稍等几秒。`;
    log("主线:停止", "网页控制台", `任务:${currentTask.label}`, `准备停止进程树，PID=${this.currentProcess.pid}`);
    this.state.setTask({
      ...currentTask,
      status: "stopping",
      awaitingConfirmation: false,
      message: stopMessage
    });
    this.pendingStopReason = `任务「${currentTask.label}」已由网页控制台手动停止。`;

    try {
      await require("../processTree").killProcessTree(child.pid);
    } catch (error) {
      if (this.currentProcess === child) {
        this.pendingStopReason = null;
        this.state.setTask({ ...currentTask, message: `停止失败：${error.message}，可以重试。` });
      }
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
    // 人工确认只属于可见首次登录任务；后台运行不等待人工输入。
    if (!this.currentProcess || !this.state.currentTask) {
      throw new Error("当前没有等待确认的登录任务。");
    }

    if (this.state.currentTask.taskName !== "login" || this.state.currentTask.status !== "running" || !this.state.currentTask.awaitingConfirmation) {
      throw new Error("当前登录流程还没进入确认阶段，请先在浏览器完成登录。");
    }

    const child = this.currentProcess;
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error("登录流程已结束，无法再发送确认，请重新执行首次登录。");
    }

    const stdin = child.stdin;
    if (!stdin || stdin.destroyed) {
      throw new Error("登录流程输入通道已关闭，无法发送确认，请重新执行首次登录。");
    }

    // 错误监听跟随整个子进程输入流，避免回调先于 error 事件移除监听造成 EPIPE 崩溃。
    stdin.write("\n");

    const nextMessage = "已发送确认，正在验证聊天工作台并保存登录态。";
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
