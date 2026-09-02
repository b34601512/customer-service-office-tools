const appConfig = require("../../config/appConfig");
const { readLoginStatus } = require("../../features/loginStatusStore");
const {
  readControlCenterConfig,
  readWecomRobotConfig
} = require("../controlCenterConfigService");
const { readDashboardSnapshot } = require("../controlCenterDashboardService");
const { writeJson } = require("./httpResponse");
const { resolveResourceRootPids } = require("./resourceRootPids");

async function handleApiGetRoute(request, response, pathname, context) {
  // 这里只处理读取类接口，让服务主入口不再关心具体数据怎么组装。
  if (request.method !== "GET") {
    return false;
  }

  if (pathname === "/api/state") {
    const config = readControlCenterConfig();
    writeJson(response, 200, {
      config,
      runtime: context.state.getSnapshot(),
      dashboard: readDashboardSnapshot(config),
      loginStatus: readLoginStatus(appConfig.loginStatusPath)
    });
    return true;
  }

  if (pathname === "/api/dashboard") {
    const config = readControlCenterConfig();
    writeJson(response, 200, {
      ok: true,
      dashboard: readDashboardSnapshot(config),
      loginStatus: readLoginStatus(appConfig.loginStatusPath)
    });
    return true;
  }

  if (pathname === "/api/control-center/watchdog-state") {
    // 这里直接读取任务服务真源，只向本机独立看门狗提供精确清理所需的最小 PID 集合。
    writeJson(response, 200, {
      ok: true,
      parentPid: process.pid,
      taskPid: context.taskService?.currentProcess?.pid || 0
    });
    return true;
  }

  if (pathname === "/api/system/resources") {
    const resources = await context.readResourceUsage({
      rootPids: resolveResourceRootPids(context.taskService, context.getResourceRootPids)
    });
    writeJson(response, 200, {
      ok: true,
      resources
    });
    return true;
  }

  if (pathname === "/api/private-config") {
    writeJson(response, 200, {
      ok: true,
      wecomRobot: readWecomRobotConfig()
    });
    return true;
  }

  return false;
}

module.exports = {
  handleApiGetRoute
};
