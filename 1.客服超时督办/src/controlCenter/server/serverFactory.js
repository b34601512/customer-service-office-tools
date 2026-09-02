const http = require("http");
const { readControlCenterResourceUsage } = require("../controlCenterResourceMonitor");
const { attachStateEventBroadcasts } = require("./eventStreamRoute");
const { dispatchControlCenterRequest } = require("./requestDispatcher");

function createServer(options) {
  // 这里统一创建主管端网页控制台服务，具体路由交给职责模块处理。
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
