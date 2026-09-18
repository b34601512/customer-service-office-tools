// 该文件负责在小蟹客服页里捕获页面自己的 WebSocket，并用它的真实 socket.io 帧执行「分配会话」。
// 平台把转接做成了 socket.io 事件（assignChat），没有对应 HTTP 接口，所以不能再走 /api/chat/assign。
const APP_SOCKET_RECORDS_KEY = "__customerServiceAppSockets";
const APP_SOCKET_PROBE_FLAG = "__customerServiceAppSocketProbeInstalled";
// socket.io 帧形如 `42/client,["事件",负载]`；带二进制附件的形如 `451-/client,["事件",{...}]`。
// 命名空间只出现在 `/xxx,` 或 `/xxx?...` 这一段；根命名空间的帧没有这一段。
const SOCKET_IO_FRAME_PREFIX_PATTERN = "^4[0-9](?:\\d+-)?(?:\\/([^,?]*)[,?])?";

// 2026-09-16 实测：页面只有一条 websocket（wss://<域名>/ws/socket.io/），上面挂了两个 socket.io 命名空间：
// /client 收发聊天与分配事件（setGroupId、markAsRead、assignChat），/notify 只收通知。
// 转接必须发到 /client，否则服务端收不到。
const CHAT_NAMESPACE_PREFERENCE = Object.freeze(["client"]);

function parseSocketIoFrameNamespace(frame) {
  // 这里给出"帧 → 命名空间"的唯一解析口径（页面内是同一份正则的副本，见 installAppSocketProbeInPage）。
  const match = new RegExp(SOCKET_IO_FRAME_PREFIX_PATTERN).exec(String(frame || ""));
  if (!match) {
    return null;
  }

  const namespace = String(match[1] || "");
  return { namespace, isRoot: namespace === "" };
}

function installAppSocketProbeInPage(probeOptions) {
  // 这段代码会在页面脚本之前执行，必须自包含，不能引用外部变量（命名空间正则通过参数传进来）。
  if (window.__customerServiceAppSocketProbeInstalled) {
    return;
  }
  const framePatternSource = String(probeOptions?.socketIoFramePattern || "").trim();
  if (!framePatternSource) {
    throw new Error("socket 探针缺少帧命名空间正则（socketIoFramePattern）。");
  }
  const framePattern = new RegExp(framePatternSource);
  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket !== "function") {
    return;
  }

  window.__customerServiceAppSocketProbeInstalled = true;
  const records = [];
  window.__customerServiceAppSockets = records;

  function rememberSocketIoNamespace(record, frame) {
    // 2026-09-18 复盘（山韵摄影转接未生效）：命名空间必须"见过就永久记住"。
    // 以前是发送时现扫最近 40 帧，长跑页面里连接帧早被心跳帧挤掉 → 前缀退化成空串 →
    // 帧发到根命名空间被平台静默丢弃，表现为"指令发出去了但平台没改派"。
    const match = framePattern.exec(String(frame || ""));
    if (!match) {
      return;
    }
    const namespace = String(match[1] || "");
    if (!namespace) {
      record.rootNamespaceSeen = true;
      return;
    }
    if (!record.seenSocketIoNamespaces.includes(namespace)) {
      record.seenSocketIoNamespaces.push(namespace);
    }
  }

  function PatchedWebSocket(url, protocols) {
    const socket = arguments.length > 1
      ? new OriginalWebSocket(url, protocols)
      : new OriginalWebSocket(url);
    const record = {
      url: String(url || ""),
      createdAtMs: Date.now(),
      outboundFrames: [],
      // 这两个字段是发送时的判定依据，只增不减。
      seenSocketIoNamespaces: [],
      rootNamespaceSeen: false,
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
          rememberSocketIoNamespace(record, event.data);
        }
      });
    } catch (error) {
      // 捕获失败只影响诊断信息，不影响页面自身通信。
    }

    const originalSend = socket.send;
    socket.send = function patchedSend(data) {
      if (typeof data === "string") {
        rememberSocketIoNamespace(record, data);
        record.outboundFrames.push(data.slice(0, 200));
        // 这只是排障用的环形缓冲（丢了不影响判定）；命名空间另有 seenSocketIoNamespaces 永久记着。
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

  return target.addInitScript(installAppSocketProbeInPage, {
    socketIoFramePattern: SOCKET_IO_FRAME_PREFIX_PATTERN
  });
}

function listRecordSocketIoNamespaces(record) {
  // 这里只读探针"永久记住"的命名空间，缺失或脏数据都当没有，避免拿猜测当依据。
  const seen = Array.isArray(record?.seenSocketIoNamespaces) ? record.seenSocketIoNamespaces : [];
  return seen.map((item) => String(item || "").trim()).filter(Boolean);
}

function resolveSocketNamespacePrefix(record, preferredNamespaces = CHAT_NAMESPACE_PREFERENCE) {
  // 唯一口径：命名空间只认探针记住的结果，绝不拿"最近若干帧"现扫（长跑页面会把连接帧挤没）。
  const known = listRecordSocketIoNamespaces(record);
  const preference = Array.isArray(preferredNamespaces) ? preferredNamespaces : [];
  const preferred = known.find((namespace) => preference.includes(namespace));
  if (preferred) {
    return { namespacePrefix: `/${preferred},`, namespace: preferred, source: "preferred" };
  }
  if (known.length > 0) {
    return { namespacePrefix: `/${known[0]},`, namespace: known[0], source: "fallback" };
  }
  if (record?.rootNamespaceSeen === true) {
    return { namespacePrefix: "", namespace: "", source: "root" };
  }

  return { namespacePrefix: null, namespace: "", source: "unknown" };
}

function planAppSocketEventTarget(candidates, options = {}) {
  // 这里挑要发帧的 socket：优先"命名空间已知且命中聊天命名空间"，其次帧数最多的那条。
  const allRecords = Array.isArray(candidates) ? candidates : [];
  const openRecords = allRecords.filter((item) => item?.readyState === 1);
  if (openRecords.length === 0) {
    return {
      ok: false,
      reason: "no_open_app_socket",
      socketCount: allRecords.length,
      message: "页面里没有处于打开状态的 socket，无法发送转接事件。"
    };
  }

  const requestedIndex = Number.isInteger(options.socketIndex) ? options.socketIndex : null;
  const pool = requestedIndex === null
    ? openRecords
    : openRecords.filter((item) => item.index === requestedIndex);
  if (pool.length === 0) {
    return {
      ok: false,
      reason: "requested_socket_not_open",
      socketCount: allRecords.length,
      message: `指定的 socket（index=${requestedIndex}）当前不可用。`
    };
  }

  const planned = pool
    .map((item) => ({ item, resolution: resolveSocketNamespacePrefix(item, options.preferredNamespaces) }))
    .filter((entry) => entry.resolution.namespacePrefix !== null);
  if (planned.length === 0) {
    return {
      ok: false,
      reason: "chat_namespace_unknown",
      socketCount: allRecords.length,
      socketIndex: pool[0]?.index,
      message: "页面 socket 还没暴露过任何 socket.io 帧，无法确认转接该发到哪个命名空间；宁可不发，也不发无名帧当哑弹。"
    };
  }

  const rank = (entry) => (entry.resolution.source === "preferred" ? 2 : (entry.resolution.source === "fallback" ? 1 : 0));
  const rankFrames = (entry) => Number(entry.item.outboundFrameCount || 0);
  const target = planned
    .slice()
    .sort((left, right) => (rank(right) - rank(left)) || (rankFrames(right) - rankFrames(left)))[0];

  return {
    ok: true,
    socketIndex: target.item.index,
    socketUrl: target.item.url,
    namespacePrefix: target.resolution.namespacePrefix,
    namespace: target.resolution.namespace,
    namespaceSource: target.resolution.source
  };
}

function buildSocketIoEventFrame(eventName, payload, namespacePrefix = "") {
  // 事件帧固定为 42 + 命名空间前缀 + ["事件名", 负载]，与页面自己 emit 的格式一致。
  return `42${namespacePrefix}${JSON.stringify([String(eventName || "").trim(), payload ?? null])}`;
}

function sanitizeSocketUrl(url) {
  // 诊断日志里不能带 token，只保留协议与路径。
  return String(url || "").split("?")[0];
}

async function inspectAppSocketRecords(page) {
  // 这里一次性读出页面里所有 socket 的状态、命名空间记忆和最近若干帧，供挑选目标与排障共用。
  const records = await page.evaluate((recordsKey) => {
    const list = window[recordsKey] || [];
    return list.map((record, index) => {
      const frames = record?.outboundFrames || [];
      return {
        index,
        url: String(record?.url || ""),
        readyState: record?.socket?.readyState ?? -1,
        outboundFrameCount: frames.length,
        firstOutboundFrames: frames.slice(0, 4),
        recentOutboundFrames: frames.slice(-4),
        lastInboundFrame: String(record?.lastInboundFrame || ""),
        seenSocketIoNamespaces: Array.isArray(record?.seenSocketIoNamespaces)
          ? record.seenSocketIoNamespaces.slice()
          : [],
        rootNamespaceSeen: record?.rootNamespaceSeen === true
      };
    });
  }, APP_SOCKET_RECORDS_KEY);

  return Array.isArray(records) ? records : [];
}

async function listAppSocketCandidates(page) {
  // 供排障使用：列出页面捕获到的 socket 及首尾若干帧，token 已剔除。
  const records = await inspectAppSocketRecords(page);
  return records.map((item) => ({
    ...item,
    url: sanitizeSocketUrl(item.url)
  }));
}

async function sendAppSocketEvent(page, input = {}) {
  // 这里把事件帧发到页面自己的 socket 上，等价于页面里 socket.emit(事件名, 负载)。
  // 分三步：读现场 → 定目标与命名空间 → 发帧。命名空间认不出来时不发（宁可不转，也不当哑弹）。
  const eventName = String(input.eventName || "").trim();
  if (!eventName) {
    throw new Error("发送页面 socket 事件失败：事件名为空。");
  }
  if (!page || typeof page.evaluate !== "function") {
    throw new Error(`发送页面 socket 事件失败：缺少页面对象（事件=${eventName}）。`);
  }

  const candidates = await inspectAppSocketRecords(page);
  const plan = planAppSocketEventTarget(candidates, {
    socketIndex: Number.isInteger(input.socketIndex) ? input.socketIndex : null,
    preferredNamespaces: input.namespacePreference
  });
  if (!plan.ok) {
    return plan;
  }

  const frame = buildSocketIoEventFrame(eventName, input.payload ?? null, plan.namespacePrefix);
  const sendResult = await page.evaluate((request) => {
    const list = window[request.recordsKey] || [];
    const record = list[request.socketIndex];
    const socket = record?.socket;
    if (!socket || socket.readyState !== 1) {
      return {
        ok: false,
        reason: "requested_socket_not_open",
        message: `指定的 socket（index=${request.socketIndex}）当前不可用。`
      };
    }

    try {
      socket.send(request.frame);
    } catch (error) {
      return {
        ok: false,
        reason: "socket_send_failed",
        message: `socket 发送失败：${error && error.message ? error.message : String(error)}`
      };
    }

    return {
      ok: true,
      reason: "",
      socketIndex: request.socketIndex,
      socketUrl: String(record?.url || "").split("?")[0],
      frameLength: request.frame.length,
      observedFrameCount: (record?.outboundFrames || []).length,
      observedFrames: (record?.outboundFrames || []).slice(-4)
    };
  }, {
    recordsKey: APP_SOCKET_RECORDS_KEY,
    socketIndex: plan.socketIndex,
    frame
  });

  if (!sendResult?.ok) {
    return sendResult;
  }

  return {
    ...sendResult,
    namespacePrefix: plan.namespacePrefix,
    namespace: plan.namespace,
    namespaceSource: plan.namespaceSource
  };
}

module.exports = {
  APP_SOCKET_PROBE_FLAG,
  APP_SOCKET_RECORDS_KEY,
  CHAT_NAMESPACE_PREFERENCE,
  SOCKET_IO_FRAME_PREFIX_PATTERN,
  buildSocketIoEventFrame,
  inspectAppSocketRecords,
  installAppSocketFrameProbe,
  installAppSocketProbeInPage,
  listAppSocketCandidates,
  parseSocketIoFrameNamespace,
  planAppSocketEventTarget,
  resolveSocketNamespacePrefix,
  sanitizeSocketUrl,
  sendAppSocketEvent
};
