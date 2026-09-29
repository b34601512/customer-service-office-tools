const http = require("http");
const { readControlCenterResourceUsage } = require("../controlCenterResourceMonitor");
const { attachStateEventBroadcasts } = require("./eventStreamRoute");
const { dispatchControlCenterRequest } = require("./requestDispatcher");

function createServer(options) {
  // 本地 HTTP 仅暴露 API（清理看门狗、资源查询等），不提供网页控制台。
  const context = {
    ...options,
    readResourceUsage: options.readResourceUsage || readControlCenterResourceUsage,
    sseClients: new Set()
  };
  const server = http.createServer((request, response) => {
    dispatchControlCenterRequest(request, response, context);
  });

  attachStateEventBroadcasts(server, context.state, context.sseClients);
  return server;
}

module.exports = {
  createServer
};
