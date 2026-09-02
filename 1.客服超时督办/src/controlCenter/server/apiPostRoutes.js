const appConfig = require("../../config/appConfig");
const {
  saveControlCenterConfig,
  saveWecomRobotConfig
} = require("../controlCenterConfigService");
const { writeJson } = require("./httpResponse");
const { parseJsonBody, readRequestBody } = require("./requestBody");
const { openLocalPath, resolveTaskStartRequest } = require("./systemActions");

async function handleApiPostRoute(request, response, pathname, context) {
  // 这里只处理会改变状态的接口，动作入口统一由后端做校验后执行。
  if (request.method !== "POST") {
    return false;
  }

  if (pathname === "/api/tasks/start") {
    const body = parseJsonBody(await readRequestBody(request));
    const taskRequest = resolveTaskStartRequest(String(body.taskName || ""));
    await context.taskService.startTask(taskRequest.taskName);
    writeJson(response, 200, { ok: true, message: taskRequest.message });
    return true;
  }

  if (pathname === "/api/tasks/confirm-login") {
    context.taskService.confirmLoginCompleted();
    writeJson(response, 200, { ok: true, message: "已发送登录完成确认。" });
    return true;
  }

  if (pathname === "/api/tasks/stop") {
    await context.taskService.stopCurrentTask();
    writeJson(response, 200, { ok: true, message: "停止指令已发送。" });
    return true;
  }

  if (pathname === "/api/control-center/shutdown") {
    if (typeof context.shutdownControlCenter !== "function") {
      throw new Error("当前控制台未配置退出处理器，无法执行彻底退出。");
    }

    let shutdownReason = "网页手动退出控制台";
    try {
      const body = parseJsonBody(await readRequestBody(request));
      shutdownReason = String(body.reason || shutdownReason).trim() || shutdownReason;
    } catch (error) {
      shutdownReason = "网页手动退出控制台";
    }

    writeJson(response, 200, {
      ok: true,
      message: "控制台正在退出，已开始清理后台任务和控制台窗口。"
    });
    setTimeout(() => {
      context.shutdownControlCenter(shutdownReason);
    }, 120);
    return true;
  }

  if (pathname === "/api/config/save") {
    const body = parseJsonBody(await readRequestBody(request));
    const config = saveControlCenterConfig(body);
    writeJson(response, 200, { ok: true, message: "配置已保存。", config });
    return true;
  }

  if (pathname === "/api/private-config/wecom/save") {
    const body = parseJsonBody(await readRequestBody(request));
    const wecomRobot = saveWecomRobotConfig(body);
    writeJson(response, 200, {
      ok: true,
      message: "企微提醒配置已保存。",
      wecomRobot
    });
    return true;
  }

  if (pathname === "/api/actions/open-project-folder") {
    openLocalPath(appConfig.projectRoot);
    writeJson(response, 200, { ok: true, message: "项目目录已打开。" });
    return true;
  }

  return false;
}

module.exports = {
  handleApiPostRoute
};
