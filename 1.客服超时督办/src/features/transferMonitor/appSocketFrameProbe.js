// 该文件负责在小蟹客服页里捕获页面自己的 WebSocket，并用它的真实 socket.io 帧执行「分配会话」。
// 平台把转接做成了 socket.io 事件（assignChat），没有对应 HTTP 接口，所以不能再走 /api/chat/assign。
const APP_SOCKET_RECORDS_KEY = "__customerServiceAppSockets";
const APP_SOCKET_PROBE_FLAG = "__customerServiceAppSocketProbeInstalled";

// 2026-09-16 实测：页面只有一条 websocket（wss://<域名>/ws/socket.io/），上面挂了两个 socket.io 命名空间：
// /client 收发聊天与分配事件（setGroupId、markAsRead、assignChat），/notify 只收通知。
// 转接必须发到 /client，否则服务端收不到。
const CHAT_NAMESPACE_PREFERENCE = Object.freeze(["client"]);

function installAppSocketProbeInPage() {
  // 这段代码会在页面脚本之前执行，必须自包含，不能引用外部变量。
  if (window.__customerServiceAppSocketProbeInstalled) {
    return;
  }
  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket !== "function") {
    return;
  }

  window.__customerServiceAppSocketProbeInstalled = true;
  const records = [];
  window.__customerServiceAppSockets = records;

  function PatchedWebSocket(url, protocols) {
    const socket = arguments.length > 1
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);
    const record = {
      url: String(url || ""),
      createdAtMs: Date.now(),
      outboundFrames: [],
      lastInboundFrame: "",
      lastInboundAtMs: 0,
      socket
    };
    records.push(record);

    try {
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          record.lastInboundFrame = event.data.slice(0, 200);
          record.lastInboundAtMs = Date.now();
        }
      });
    } catch (error) {
      // 捕获失败只影响诊断信息，不影响页面自身通信。
    }

    const originalSend = socket.send;
    socket.send = function patchedSend(data) {
      if (typeof data === "string") {
        record.outboundFrames.push(data.slice(0, 200));
        if (record.outboundFrames.length > 40) {
          record.outboundFrames.shift();
        }
      }
      return originalSend.apply(socket, arguments);
    };

    return socket;
  }

  PatchedWebSocket.prototype = OriginalWebSocket.prototype;
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) {
    try {
      PatchedWebSocket[key] = OriginalWebSocket[key];
    } catch (error) {
      // 个别浏览器把常量定义成只读，取不到就跳过，不影响实例使用。
    }
  }

  window.WebSocket = PatchedWebSocket;
}

function installAppSocketFrameProbe(target) {
  // target 可以是 BrowserContext 或 Page；必须在页面脚本执行前安装才能捕获到 socket 实例。
  if (!target || typeof target.addInitScript !== "function") {
    throw new Error("安装页面 socket 探针失败：目标不支持 addInitScript。");
  }

  return target.addInitScript(installAppSocketProbeInPage);
}

function listSocketNamespaces(outboundFrames) {
  // socket.io v4 帧：40/ns, 连接、42/ns,[...] 事件；
  // 页面把 token 写在 URL 里，连接帧的命名空间会带 ?token=...，必须去掉 query 才能得到真实命名空间。
  const namespaces = [];
  for (const frame of Array.isArray(outboundFrames) ? outboundFrames : []) {
    const match = /^4[0-9](?:\/([^,]*),)?/.exec(String(frame || ""));
    if (!match) {
      continue;
    }

    const namespace = String(match[1] || "").split("?")[0].replace(/^\/+/, "");
    if (!namespaces.includes(namespace)) {
      namespaces.push(namespace);
    }
  }

  return namespaces;
}

function buildSocketIoNamespacePrefix(outboundFrames, preferredNamespaces = CHAT_NAMESPACE_PREFERENCE) {
  // 同一条 websocket 上多个命名空间时优先用聊天命名空间，否则回退到页面第一个连接过的命名空间。
  const namespaces = listSocketNamespaces(outboundFrames);
  const preference = Array.isArray(preferredNamespaces) ? preferredNamespaces : [];
  const preferred = namespaces.find((namespace) => preference.includes(namespace));
  const chosen = preferred !== undefined ? preferred : (namespaces[0] || "");
  return chosen ? `/${chosen},` : "";
}

function buildSocketIoEventFrame(eventName, payload, namespacePrefix = "") {
  // 事件帧固定为 42 + 命名空间前缀 + ["事件名", 负载]，与页面自己 emit 的格式一致。
  return `42${namespacePrefix}${JSON.stringify([String(eventName || "").trim(), payload ?? null])}`;
}

function sanitizeSocketUrl(url) {
  // 诊断日志里不能带 token，只保留协议与路径。
  return String(url || "").split("?")[0];
}

async function listAppSocketCandidates(page) {
  // 供排障使用：列出页面捕获到的 socket 及首尾若干帧，token 已剔除。
  const candidates = await page.evaluate((recordsKey) => {
    const records = window[recordsKey] || [];
    return records.map((record, index) => {
      const frames = record?.outboundFrames || [];
      return {
        index,
        url: String(record?.url || ""),
        readyState: record?.socket?.readyState ?? -1,
        outboundFrameCount: frames.length,
        firstOutboundFrames: frames.slice(0, 4),
        recentOutboundFrames: frames.slice(-4),
        lastInboundFrame: String(record?.lastInboundFrame || "")
      };
    });
  }, APP_SOCKET_RECORDS_KEY);

  return candidates.map((item) => ({
    ...item,
    url: sanitizeSocketUrl(item.url)
  }));
}

async function sendAppSocketEvent(page, input = {}) {
  // 这里把事件帧发到页面自己的 socket 上，等价于页面里 socket.emit(事件名, 负载)。
  const eventName = String(input.eventName || "").trim();
  if (!eventName) {
    throw new Error("发送页面 socket 事件失败：事件名为空。");
  }
  if (!page) {
    throw new Error(`发送页面 socket 事件失败：缺少页面对象（事件=${eventName}）。`);
  }

  return page.evaluate((request) => {
    const records = window[request.recordsKey] || [];
    const openRecords = records
      .map((record, index) => ({ record, index }))
      .filter((item) => item.record?.socket && item.record.socket.readyState === 1);

    if (openRecords.length === 0) {
      return {
        ok: false,
        reason: "no_open_app_socket",
        socketCount: records.length,
        message: "页面里没有处于打开状态的 socket，无法发送转接事件。"
      };
    }

    const resolveNamespacePrefix = (outboundFrames) => {
      const namespaces = [];
      for (const frame of Array.isArray(outboundFrames) ? outboundFrames : []) {
        const match = /^4[0-9](?:\/([^,]*),)?/.exec(String(frame || ""));
        if (!match) {
          continue;
        }

        const namespace = String(match[1] || "").split("?")[0].replace(/^\/+/, "");
        if (!namespaces.includes(namespace)) {
          namespaces.push(namespace);
        }
      }

      const preference = Array.isArray(request.namespacePreference) ? request.namespacePreference : [];
      const preferred = namespaces.find((namespace) => preference.includes(namespace));
      const chosen = preferred !== undefined ? preferred : (namespaces[0] || "");
      return chosen ? `/${chosen},` : "";
    };

    const requestedIndex = Number.isInteger(request.socketIndex) ? request.socketIndex : null;
    const target = requestedIndex === null
      ? openRecords.slice().sort((left, right) =>
        (right.record.outboundFrames || []).length - (left.record.outboundFrames || []).length)[0]
      : openRecords.find((item) => item.index === requestedIndex);

    if (!target) {
      return {
        ok: false,
        reason: "requested_socket_not_open",
        socketCount: records.length,
        message: `指定的 socket（index=${requestedIndex}）当前不可用。`
      };
    }

    const namespacePrefix = resolveNamespacePrefix(target.record.outboundFrames);
    const frame = `42${namespacePrefix}${JSON.stringify([request.eventName, request.payload ?? null])}`;

    try {
      target.record.socket.send(frame);
    } catch (error) {
      return {
        ok: false,
        reason: "socket_send_failed",
        socketCount: records.length,
        socketIndex: target.index,
        message: `socket 发送失败：${error && error.message ? error.message : String(error)}`
      };
    }

    return {
      ok: true,
      reason: "",
      socketIndex: target.index,
      socketUrl: String(target.record.url || "").split("?")[0],
      namespacePrefix,
      frameLength: frame.length,
      observedFrameCount: (target.record.outboundFrames || []).length,
      observedFrames: (target.record.outboundFrames || []).slice(-4)
    };
  }, {
    recordsKey: APP_SOCKET_RECORDS_KEY,
    eventName,
    payload: input.payload ?? null,
    namespacePreference: CHAT_NAMESPACE_PREFERENCE,
    socketIndex: Number.isInteger(input.socketIndex) ? input.socketIndex : null
  });
}

module.exports = {
  APP_SOCKET_PROBE_FLAG,
  APP_SOCKET_RECORDS_KEY,
  CHAT_NAMESPACE_PREFERENCE,
  buildSocketIoEventFrame,
  buildSocketIoNamespacePrefix,
  installAppSocketFrameProbe,
  installAppSocketProbeInPage,
  listAppSocketCandidates,
  listSocketNamespaces,
  sanitizeSocketUrl,
  sendAppSocketEvent
};
