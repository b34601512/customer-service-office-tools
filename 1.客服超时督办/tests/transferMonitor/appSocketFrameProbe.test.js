const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHAT_NAMESPACE_PREFERENCE,
  SOCKET_IO_FRAME_PREFIX_PATTERN,
  buildSocketIoEventFrame,
  installAppSocketFrameProbe,
  installAppSocketProbeInPage,
  listAppSocketCandidates,
  parseSocketIoFrameNamespace,
  planAppSocketEventTarget,
  resolveSocketNamespacePrefix,
  sanitizeSocketUrl,
  sendAppSocketEvent
} = require("../../src/features/transferMonitor/appSocketFrameProbe");

// 页面里的 WebSocket 用最小替身：能被探针包装，也能手工灌入/读出报文。
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listenersByType = new Map();
    this.sentFrames = [];
  }

  addEventListener(type, listener) {
    const listeners = this.listenersByType.get(type) || [];
    listeners.push(listener);
    this.listenersByType.set(type, listeners);
  }

  send(data) {
    this.sentFrames.push(data);
  }

  fireMessage(data) {
    (this.listenersByType.get("message") || []).forEach((listener) => listener({ data }));
  }
}

// 真正跑一遍页面内探针代码，拿到它记下的 record（不是手写替身），保证测的是真实口径。
// 返回的 baselineSentFrameCounts 是"搭现场时"页面自己发掉的帧数，断言时只看这之后的增量。
function buildProbedRecords(socketSpecs) {
  const originalWindow = global.window;
  const windowObject = { WebSocket: FakeWebSocket };
  global.window = windowObject;
  try {
    installAppSocketProbeInPage({ socketIoFramePattern: SOCKET_IO_FRAME_PREFIX_PATTERN });
    const sockets = socketSpecs.map((spec) => {
      const socket = new windowObject.WebSocket(spec.url || "wss://zan-mh.xiaoshunai.com/ws/socket.io/?token=secret");
      (spec.inbound || []).forEach((frame) => socket.fireMessage(frame));
      (spec.outbound || []).forEach((frame) => socket.send(frame));
      return socket;
    });
    return {
      records: windowObject.__customerServiceAppSockets,
      sockets,
      baselineSentFrameCounts: sockets.map((socket) => socket.sentFrames.length)
    };
  } finally {
    global.window = originalWindow;
  }
}

function buildFakePage(records) {
  return {
    async evaluate(pageFunction, argument) {
      const originalWindow = global.window;
      global.window = { __customerServiceAppSockets: records };
      try {
        return pageFunction(argument);
      } finally {
        global.window = originalWindow;
      }
    },
    async addInitScript() {
      return undefined;
    }
  };
}

function framesSentSince(socket, baselineCount) {
  return socket.sentFrames.slice(baselineCount);
}

// 引擎心跳（engine.io 的 pong）——今天就是它们把连接帧挤出了 40 帧窗口。
const HEARTBEAT_FRAMES = Array.from({ length: 40 }, () => "3");
const CLIENT_CONNECT_FRAME = "40/client?token=eyJhbGciOiJIUzI1NiJ9.abc&console=xiaoju-bot-pc,";

test("帧 → 命名空间：认得出 /client、根命名空间、二进制帧和非 socket.io 帧", () => {
  assert.deepEqual(parseSocketIoFrameNamespace(CLIENT_CONNECT_FRAME), { namespace: "client", isRoot: false });
  assert.deepEqual(parseSocketIoFrameNamespace("42/client,[\"markAsRead\",{}]"), { namespace: "client", isRoot: false });
  assert.deepEqual(
    parseSocketIoFrameNamespace("451-/client,[\"message\",{\"_placeholder\":true,\"num\":0}]"),
    { namespace: "client", isRoot: false }
  );
  assert.deepEqual(parseSocketIoFrameNamespace("40"), { namespace: "", isRoot: true });
  assert.deepEqual(parseSocketIoFrameNamespace("42[\"markAsRead\",{}]"), { namespace: "", isRoot: true });
  assert.equal(parseSocketIoFrameNamespace("0{\"sid\":\"x\"}"), null);
  assert.equal(parseSocketIoFrameNamespace("3"), null);
  assert.equal(parseSocketIoFrameNamespace(""), null);
});

test("命名空间与正则只留一份口径：装探针时必须把正则带进页面", async () => {
  const calls = [];
  await installAppSocketFrameProbe({
    addInitScript: async (pageFunction, argument) => {
      calls.push({ pageFunction, argument });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].argument.socketIoFramePattern, SOCKET_IO_FRAME_PREFIX_PATTERN);

  // 真正执行一遍：没有正则就不许继续（防"退回无名帧"这种静默降级）。
  const originalWindow = global.window;
  global.window = { WebSocket: FakeWebSocket };
  try {
    assert.throws(() => calls[0].pageFunction({}), /socketIoFramePattern/);
    assert.throws(() => installAppSocketProbeInPage(undefined), /socketIoFramePattern/);
  } finally {
    global.window = originalWindow;
  }
});

test("命名空间见过就永久记住：连接帧被 40 帧心跳挤出窗口后仍然知道是 /client", () => {
  const { records } = buildProbedRecords([
    { outbound: [CLIENT_CONNECT_FRAME, ...HEARTBEAT_FRAMES], inbound: ["42/client,[\"message\",{}]"] }
  ]);

  assert.deepEqual(records[0].seenSocketIoNamespaces, ["client"]);
  // 复现今天现场：诊断窗口里已经一条连接帧都找不到了（旧实现就是因此把前缀算成空串）。
  assert.equal(records[0].outboundFrames.length, 40);
  assert.equal(records[0].outboundFrames.some((frame) => frame.includes("/client")), false);
});

test("现场复现（2026-09-18 山韵摄影）：长跑页面发转接必须仍带 /client 前缀", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    { outbound: [CLIENT_CONNECT_FRAME, ...HEARTBEAT_FRAMES], inbound: ["42/client,[\"message\",{}]"] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), {
    eventName: "assignChat",
    payload: { chatId: "chat-1", groupId: "group", assigneeId: "pre-ye" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.socketIndex, 0);
  assert.equal(result.namespacePrefix, "/client,");
  assert.equal(result.namespaceSource, "preferred");
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), [
    "42/client,[\"assignChat\",{\"chatId\":\"chat-1\",\"groupId\":\"group\",\"assigneeId\":\"pre-ye\"}]"
  ]);
});

test("反向断言：完全没有 socket.io 证据时不许发无名帧", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    { outbound: [...HEARTBEAT_FRAMES] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), {
    eventName: "assignChat",
    payload: { chatId: "chat-1", assigneeId: "pre-ye" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "chat_namespace_unknown");
  // 关键断言：一帧都不许发出去（旧实现会发 42["assignChat",...] 到根命名空间当哑弹）。
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), []);
});

test("根命名空间（页面真的连在根上）仍按老口径发，不误判成未知", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    { outbound: ["40", "42[\"markAsRead\",{}]"] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), { eventName: "assignChat", payload: { chatId: "c" } });

  assert.equal(result.ok, true);
  assert.equal(result.namespacePrefix, "");
  assert.equal(result.namespaceSource, "root");
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), ["42[\"assignChat\",{\"chatId\":\"c\"}]"]);
});

test("多条 socket 时优先命中聊天命名空间，其次才比帧数", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    // 帧更多，但只连在根命名空间上（例如侧边栏 iframe 的独立连接）。
    { url: "wss://other/socket.io/?token=a", outbound: ["40", "3", "3", "3", "3"] },
    { url: "wss://zan-mh.xiaoshunai.com/ws/socket.io/?token=b", outbound: [CLIENT_CONNECT_FRAME, "3"] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), { eventName: "assignChat", payload: { chatId: "c" } });

  assert.equal(result.ok, true);
  assert.equal(result.socketIndex, 1);
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), []);
  assert.deepEqual(framesSentSince(sockets[1], baselineSentFrameCounts[1]), [
    "42/client,[\"assignChat\",{\"chatId\":\"c\"}]"
  ]);
});

test("同样都命中聊天命名空间时，取帧最多的那条", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    { url: "wss://a/socket.io/?token=a", outbound: [CLIENT_CONNECT_FRAME] },
    { url: "wss://b/socket.io/?token=b", outbound: [CLIENT_CONNECT_FRAME, "3", "3"] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), { eventName: "assignChat", payload: { chatId: "c" } });

  assert.equal(result.ok, true);
  assert.equal(result.socketIndex, 1);
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), []);
  assert.deepEqual(framesSentSince(sockets[1], baselineSentFrameCounts[1]), [
    "42/client,[\"assignChat\",{\"chatId\":\"c\"}]"
  ]);
});

test("页面没有可用 socket 时返回可读原因，不抛无关异常", async () => {
  const { records } = buildProbedRecords([{ outbound: [CLIENT_CONNECT_FRAME] }]);
  records[0].socket.readyState = 3;

  const result = await sendAppSocketEvent(buildFakePage(records), {
    eventName: "assignChat",
    payload: { chatId: "c" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_open_app_socket");
});

test("点名了不可用的 socket 时不偷偷换一条", async () => {
  const { records, sockets, baselineSentFrameCounts } = buildProbedRecords([
    { outbound: [CLIENT_CONNECT_FRAME] },
    { outbound: [CLIENT_CONNECT_FRAME] }
  ]);

  const result = await sendAppSocketEvent(buildFakePage(records), {
    eventName: "assignChat",
    payload: { chatId: "c" },
    socketIndex: 5
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "requested_socket_not_open");
  assert.deepEqual(framesSentSince(sockets[0], baselineSentFrameCounts[0]), []);
  assert.deepEqual(framesSentSince(sockets[1], baselineSentFrameCounts[1]), []);
});

test("命名空间三态判定：命中优先、否则回落、再否则未知", () => {
  assert.deepEqual(resolveSocketNamespacePrefix({ seenSocketIoNamespaces: ["notify", "client"] }), {
    namespacePrefix: "/client,",
    namespace: "client",
    source: "preferred"
  });
  assert.deepEqual(resolveSocketNamespacePrefix({ seenSocketIoNamespaces: ["notify"] }), {
    namespacePrefix: "/notify,",
    namespace: "notify",
    source: "fallback"
  });
  assert.deepEqual(resolveSocketNamespacePrefix({ rootNamespaceSeen: true }), {
    namespacePrefix: "",
    namespace: "",
    source: "root"
  });
  assert.deepEqual(resolveSocketNamespacePrefix({}), {
    namespacePrefix: null,
    namespace: "",
    source: "unknown"
  });
  assert.equal(planAppSocketEventTarget([]).reason, "no_open_app_socket");
  assert.deepEqual(CHAT_NAMESPACE_PREFERENCE, ["client"]);
});

test("事件帧格式与页面自身 emit 一致", () => {
  assert.equal(
    buildSocketIoEventFrame("assignChat", { chatId: "chat-1", assigneeId: "pre-1" }),
    "42[\"assignChat\",{\"chatId\":\"chat-1\",\"assigneeId\":\"pre-1\"}]"
  );
  assert.equal(
    buildSocketIoEventFrame("assignChat", { chatId: "chat-1" }, "/client,"),
    "42/client,[\"assignChat\",{\"chatId\":\"chat-1\"}]"
  );
});

test("诊断输出带上命名空间记忆，且不泄露 token", async () => {
  const { records } = buildProbedRecords([{ outbound: [CLIENT_CONNECT_FRAME, ...HEARTBEAT_FRAMES] }]);

  const candidates = await listAppSocketCandidates(buildFakePage(records));

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "wss://zan-mh.xiaoshunai.com/ws/socket.io/");
  assert.deepEqual(candidates[0].seenSocketIoNamespaces, ["client"]);
  assert.equal(candidates[0].rootNamespaceSeen, false);
  assert.equal(sanitizeSocketUrl("wss://host/socket.io/?token=secret"), "wss://host/socket.io/");
});
