const { log } = require("../../engine/logger");
const { writeJson, writeText } = require("./httpResponse");
const { handleApiGetRoute } = require("./apiGetRoutes");
const { handleApiPostRoute } = require("./apiPostRoutes");
const { handleDocumentRoute } = require("./documentRoutes");
const { handleEventStreamRoute } = require("./eventStreamRoute");
const { handleStaticRoute } = require("./staticRoutes");

async function dispatchControlCenterRequest(request, response, context) {
  // 这里按路由类型顺序分发请求，createServer 只负责把请求交给调度器。
  try {
    const url = new URL(request.url, `http://127.0.0.1:${context.port}`);
    const pathname = url.pathname;

    if (handleStaticRoute(request, response, pathname, context.webRoot)) {
      return;
    }

    if (await handleApiGetRoute(request, response, pathname, context)) {
      return;
    }

    if (handleEventStreamRoute(request, response, pathname, context.state, context.sseClients)) {
      return;
    }

    if (handleDocumentRoute(request, response, pathname)) {
      return;
    }

    if (await handleApiPostRoute(request, response, pathname, context)) {
      return;
    }

    response.statusCode = 404;
    response.end("未找到请求资源。");
  } catch (error) {
    log("主线:失败", "网页控制台", "接口异常", error.message);
    writeJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

module.exports = {
  dispatchControlCenterRequest
};
