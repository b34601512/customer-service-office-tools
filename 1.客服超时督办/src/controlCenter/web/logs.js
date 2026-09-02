const logOutput = document.getElementById("logOutput");
const logStatusText = document.getElementById("logStatusText");
const logChannelButtons = Array.from(document.querySelectorAll("[data-log-channel]"));

const LOG_CHANNEL_LABELS = {
  timeout: "超时日志",
  missed_reply: "漏回复日志",
  online_presence: "上班监控日志",
  off_duty: "下班监控日志"
};

let currentLogs = [];
let currentLogsByChannel = {
  timeout: [],
  missed_reply: [],
  online_presence: [],
  off_duty: []
};
let currentLogChannel = "timeout";
let eventSource = null;

function normalizeLogMap(logLinesByChannel) {
  // 这里统一补齐日志通道结构，避免某个通道暂时没日志时前端读到 undefined。
  const normalizedMap = {
    timeout: [],
    missed_reply: [],
    online_presence: [],
    off_duty: []
  };

  for (const channel of Object.keys(normalizedMap)) {
    normalizedMap[channel] = Array.isArray(logLinesByChannel?.[channel])
      ? logLinesByChannel[channel].slice(-200)
      : [];
  }

  return normalizedMap;
}

function buildLogOutputText(lines) {
  // 这里统一把日志改成倒序展示，让主管打开面板时最先看到最新一条。
  if (!Array.isArray(lines) || lines.length === 0) {
    return "";
  }

  return lines.slice().reverse().join("\n");
}

function renderActiveLogChannel() {
  // 这里按当前选中的通道渲染日志区，只显示主管此刻真正想看的那条链路。
  logChannelButtons.forEach((button) => {
    const isActive = button.dataset.logChannel === currentLogChannel;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  const lines = currentLogsByChannel[currentLogChannel] || [];
  if (lines.length > 0) {
    logOutput.textContent = buildLogOutputText(lines);
    return;
  }

  logOutput.textContent = `${LOG_CHANNEL_LABELS[currentLogChannel] || "当前日志"}暂时还没有后台日志。`;
}

function renderLogs(logLinesByChannel, logLines) {
  // 这里统一渲染后台实时日志，网页端保留原始日志总线，同时按通道切片展示。
  currentLogs = Array.isArray(logLines) ? logLines.slice(-200) : [];
  currentLogsByChannel = normalizeLogMap(logLinesByChannel);
  renderActiveLogChannel();
}

function appendRealtimeLog(payload) {
  // 这里统一处理 SSE 增量日志，避免每次都等全量快照回来才刷新日志区。
  const line = String(payload?.line || "");
  if (!line) {
    return;
  }

  currentLogs.push(line);
  if (currentLogs.length > 200) {
    currentLogs.shift();
  }

  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  channels.forEach((channel) => {
    if (!currentLogsByChannel[channel]) {
      currentLogsByChannel[channel] = [];
    }

    currentLogsByChannel[channel].push(line);
    if (currentLogsByChannel[channel].length > 200) {
      currentLogsByChannel[channel].shift();
    }
  });

  renderActiveLogChannel();
}

function setActiveLogChannel(channel) {
  // 这里统一切换日志视图，避免每个按钮自己去拼接日志内容。
  if (!LOG_CHANNEL_LABELS[channel]) {
    return;
  }

  currentLogChannel = channel;
  renderActiveLogChannel();
}

// requestJson 由 /shared/requestJson.js 提供，与 viewer.js/app/settings 共用同一份实现（issue #551）。

function setLogStatus(message) {
  // 这里统一更新日志页状态，让连接是否正常始终在可见范围。
  logStatusText.textContent = message;
}

async function loadInitialState() {
  // 这里统一加载日志页首屏数据，保证打开页面就能看到最近日志。
  const data = await requestJson("/api/state", { method: "GET" });
  renderLogs(data.runtime.logLinesByChannel, data.runtime.logLines);
  setLogStatus("日志页已连接，正在接收实时更新。");
}

function bindActions() {
  // 这里统一绑定日志页操作，通道切换和返回入口各自只做一件事。
  logChannelButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveLogChannel(button.dataset.logChannel);
    });
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      setLogStatus(`正在打开「${button.textContent}」。`);
      window.location.href = button.dataset.route;
    });
  });
}

function subscribeEvents() {
  // 这里统一订阅 SSE 日志事件，让日志页保持实时刷新。
  eventSource = new EventSource("/api/events");

  eventSource.addEventListener("log", (event) => {
    appendRealtimeLog(JSON.parse(event.data));
  });

  eventSource.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    renderLogs(payload.logLinesByChannel, payload.logLines);
  });

  eventSource.onerror = () => {
    setLogStatus("日志连接暂时中断，页面会自动重连。");
  };
}

async function bootstrap() {
  // 这里统一编排日志页初始化，先绑定交互再加载状态和订阅实时流。
  bindActions();
  await loadInitialState();
  subscribeEvents();
}

function shouldAutoBootstrap() {
  // 这里给测试环境留一个显式开关，避免脚本一加载就发请求导致前端回归测试失真。
  return typeof window !== "undefined" && window.__CONTROL_CENTER_DISABLE_BOOTSTRAP__ !== true;
}

if (shouldAutoBootstrap()) {
  bootstrap().catch((error) => {
    setLogStatus(error.message);
    logOutput.textContent = "页面初始化失败，请刷新后重试。";
  });
}
