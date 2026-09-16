const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHAT_NAMESPACE_PREFERENCE,
  buildSocketIoEventFrame,
  buildSocketIoNamespacePrefix,
  listAppSocketCandidates,
  listSocketNamespaces,
  sanitizeSocketUrl,
  sendAppSocketEvent
} = require("../../src/features/transferMonitor/appSocketFrameProbe");

function buildFakePage(records) {
  // 用最小的 window 替身执行页面内逻辑，保证测的是真实发送路径而不是替身逻辑。
  const sentFrames = [];
  return {
    sentFrames,
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

function buildSocketRecord(url, outboundFrames, options = {}) {
  return {
    url,
    outboundFrames,
    lastInboundFrame: "",
    socket: {
      readyState: options.readyState ?? 1,
      send(frame) {
        options.sentFrames?.push(frame);
      }
    }
  };
}

test("socket.io 命名空间前缀按页面自己的连接帧推导，并去掉 URL 里的 token", () => {
  const withToken = "40/client?token=eyJhbGciOiJIUzI1NiJ9.abc&console=xiaoju-bot-pc,";

  assert.equal(buildSocketIoNamespacePrefix(["0{\"sid\":\"x\"}", "40"]), "");
  assert.equal(buildSocketIoNamespacePrefix(["40/chat,", "42/chat,[\"markAsRead\",{}]"]), "/chat,");
  assert.equal(buildSocketIoNamespacePrefix([withToken]), "/client,");
  assert.equal(buildSocketIoNamespacePrefix(["42[\"markAsRead\",{}]"]), "");
  assert.equal(buildSocketIoNamespacePrefix(["0{\"sid\":\"x\"}"]), "");
});

test("同一条 websocket 上多个命名空间时优先发到聊天命名空间", () => {
  // 线上实测：同一条连接上 /notify 只收通知，聊天与分配事件全在 /client。
  const frames = [
    "40/notify?token=secret&console=xiaoju-bot-pc,",
    "40/client?token=secret&console=xiaoju-bot-pc,",
    "42/notify,[\"setUserNotifyCenter\",{}]",
    "42/client,[\"setGroupId\",{}]"
  ];

  assert.deepEqual(listSocketNamespaces(frames), ["notify", "client"]);
  assert.equal(buildSocketIoNamespacePrefix(frames), "/client,");
  assert.deepEqual(CHAT_NAMESPACE_PREFERENCE, ["client"]);
});

test("事件帧格式与页面自身 emit 一致", () => {
  assert.equal(
    buildSocketIoEventFrame("assignChat", { chatId: "chat-1", assigneeId: "pre-1" }),
    "42[\"assignChat\",{\"chatId\":\"chat-1\",\"assigneeId\":\"pre-1\"}]"
  );
  assert.equal(
    buildSocketIoEventFrame("assignChat", { chatId: "chat-1" }, "/chat,"),
    "42/chat,[\"assignChat\",{\"chatId\":\"chat-1\"}]"
  );
});

test("把转接事件发到页面自己的 socket 上，并带上真实命名空间", async () => {
  const sentFrames = [];
  const page = buildFakePage([
    buildSocketRecord(
      "wss://zan-mh.xiaoshunai.com/ws/socket.io/?token=secret",
      ["0{}", "40/notify?token=secret&console=xiaoju-bot-pc,", "40/client?token=secret&console=xiaoju-bot-pc,"],
      { sentFrames }
    )
  ]);

  const result = await sendAppSocketEvent(page, {
    eventName: "assignChat",
    payload: { chatId: "chat-1", assigneeId: "pre-ye" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.socketIndex, 0);
  assert.equal(result.namespacePrefix, "/client,");
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0], "42/client,[\"assignChat\",{\"chatId\":\"chat-1\",\"assigneeId\":\"pre-ye\"}]");
});

test("同时存在多个 socket 时优先用帧最多的那个", async () => {
  const firstSent = [];
  const secondSent = [];
  const page = buildFakePage([
    buildSocketRecord("wss://host/socket.io/?token=a", ["0{}"], { sentFrames: firstSent }),
    buildSocketRecord("wss://host/socket.io/?token=b", ["0{}", "40", "42[\"markAsRead\",{}]"], { sentFrames: secondSent })
  ]);

  const result = await sendAppSocketEvent(page, { eventName: "assignChat", payload: { chatId: "c" } });

  assert.equal(result.ok, true);
  assert.equal(result.socketIndex, 1);
  assert.equal(firstSent.length, 0);
  assert.equal(secondSent.length, 1);
});

test("页面没有可用 socket 时返回可读原因，不抛无关异常", async () => {
  const page = buildFakePage([
    buildSocketRecord("wss://host/socket.io/?token=a", [], { readyState: 3 })
  ]);

  const result = await sendAppSocketEvent(page, { eventName: "assignChat", payload: { chatId: "c" } });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_open_app_socket");
});

test("诊断输出不泄露 token", async () => {
  const page = buildFakePage([
    buildSocketRecord("wss://host/socket.io/?token=secret-token&console=xiaoju-bot-pc", ["40"])
  ]);

  const candidates = await listAppSocketCandidates(page);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, "wss://host/socket.io/");
  assert.equal(sanitizeSocketUrl("wss://host/socket.io/?token=secret"), "wss://host/socket.io/");
});
