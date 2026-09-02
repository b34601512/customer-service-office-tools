function writeServerSentEvent(response, eventName, payload) {
  // 这里统一输出 SSE 事件，避免状态事件和日志事件各自拼字符串。
  response.write(`event: ${eventName}
data: ${JSON.stringify(payload)}

`);
}

function handleEventStreamRoute(request, response, pathname, state, sseClients) {
  // 这里只处理浏览器事件流连接，主路由不保存长连接细节。
  if (request.method !== "GET" || pathname !== "/api/events") {
    return false;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive"
  });
  writeServerSentEvent(response, "state", state.getSnapshot());
  sseClients.add(response);
  request.on("close", () => {
    sseClients.delete(response);
  });
  return true;
}

function attachStateEventBroadcasts(server, state, sseClients) {
  // 这里集中绑定事件广播，避免 createServer 里混入两个事件循环细节。
  state.eventBus.on("log", (line) => {
    for (const client of sseClients) {
      writeServerSentEvent(client, "log", line);
    }
  });

  state.eventBus.on("state", (snapshot) => {
    for (const client of sseClients) {
      writeServerSentEvent(client, "state", snapshot);
    }
  });

  server.on("close", () => {
    sseClients.clear();
  });
}

module.exports = {
  attachStateEventBroadcasts,
  handleEventStreamRoute,
  writeServerSentEvent
};
