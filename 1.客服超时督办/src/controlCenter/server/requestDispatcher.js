const { log } = require("../../engine/logger");
const { writeJson, writeText } = require("./httpResponse");
const { handleApiGetRoute } = require("./apiGetRoutes");
const { handleApiPostRoute } = require("./apiPostRoutes");
const { handleEventStreamRoute } = require("./eventStreamRoute");

async function dispatchControlCenterRequest(request, response, context) {
  // 控制台仅保留 TUI；HTTP 只服务 API 与清理看门狗，不再提供网页静态资源。
  try {
    const url = new URL(request.url, `http://127.0.0.1:${context.port}`);
    const pathname = url.pathname;

    if (await handleApiGetRoute(request, response, pathname, context)) {
      return;
    }

    if (handleEventStreamRoute(request, response, pathname, context.state, context.sseClients)) {
      return;
    }

    if (await handleApiPostRoute(request, response, pathname, context)) {
      return;
    }

    response.statusCode = 404;
    response.end("未找到请求资源。");
  } catch (error) {
    log("主线:失败", "控制台", "接口异常", error.message);
    writeJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

module.exports = {
  dispatchControlCenterRequest
};
