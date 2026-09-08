const fs = require("fs");
const path = require("path");

const DEFAULT_TARGET_URL =
  "https://zan-mh.xiaoshunai.com/";

function normalizeScheduleUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { throw new Error("排班表地址不是合法 URL。"); }
  if (url.protocol !== "https:") throw new Error("排班表地址必须使用 https。");
  return url.toString();
}

function normalizeTargetUrl(value) {
  // 这里只校验基础 URL 格式，允许先填域名；登录成功后再自动捕获完整聊天页地址。
  const rawValue = String(value || DEFAULT_TARGET_URL).trim();
  let parsedUrl;

  try {
    parsedUrl = new URL(rawValue);
  } catch (error) {
    throw new Error(`客服工作台地址不是合法 URL：${rawValue}`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(`客服工作台地址只支持 http/https：${rawValue}`);
  }

  if (parsedUrl.pathname === "/closeLogin") {
    parsedUrl.pathname = "/";
    parsedUrl.search = "";
    parsedUrl.hash = "";
  }

  return parsedUrl.toString();
}

function isFullTargetUrl(value) {
  // 这里判断是否已经是程序可直接执行的聊天工作台地址，后续接口要依赖其中的组织和分组 ID。
  let parsedUrl;
  try {
    parsedUrl = new URL(String(value || "").trim());
  } catch (error) {
    return false;
  }

  const segments = parsedUrl.pathname.split("/").filter(Boolean);
  return segments[0] === "main" && segments.length >= 4 && segments[3] === "chat";
}

function assertFullTargetUrl(value) {
  // 这里给后台监控入口做强校验，避免缺少组织和分组 ID 时继续运行到黑箱接口错误。
  const targetUrl = normalizeTargetUrl(value);
  if (!isFullTargetUrl(targetUrl)) {
    throw new Error(`客服工作台地址还不是完整聊天页，请登录后进入聊天工作台，再点击「完成登录」自动捕获。当前地址：${targetUrl}`);
  }

  return targetUrl;
}

function resolveLoginEntryUrl(value) {
  // 这里登录入口永远走小蟹账号密码页，完整聊天页只用于登录后的业务访问。
  const targetUrl = normalizeTargetUrl(value);
  const parsedUrl = new URL(targetUrl);
  return `${parsedUrl.origin}/closeLogin`;
}

function resolveWorkEntryUrl(value) {
  // 这里给后台运行选择工作台入口，避免把 closeLogin 登录页当成长期业务入口反复打开。
  const targetUrl = normalizeTargetUrl(value);
  if (isFullTargetUrl(targetUrl)) {
    return targetUrl;
  }

  const parsedUrl = new URL(targetUrl);
  return `${parsedUrl.origin}/main`;
}

function readAppRuntimeConfig(configPath) {
  // 这里统一读取本机运行配置；文件不存在时走默认值，保证老项目复制后还能启动。
  if (!fs.existsSync(configPath)) {
    return {
      targetUrl: DEFAULT_TARGET_URL,
      scheduleUrl: "",
      managerStaffName: ""
    };
  }

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`本机运行配置不是合法 JSON：${configPath}，原因=${error.message}`);
  }

  return {
    targetUrl: normalizeTargetUrl(payload.targetUrl || payload.target_url || DEFAULT_TARGET_URL),
    scheduleUrl: normalizeScheduleUrl(payload.scheduleUrl),
    managerStaffName: String(payload.managerStaffName || "").trim()
  };
}

function writeAppRuntimeConfig(configPath, payload) {
  // 这里统一写入本机运行配置，避免客服工作台地址继续散落在代码里。
  const currentConfig = readAppRuntimeConfig(configPath);
  const nextConfig = {
    targetUrl: normalizeTargetUrl(payload?.targetUrl ?? payload?.target_url ?? currentConfig.targetUrl),
    scheduleUrl: normalizeScheduleUrl(payload?.scheduleUrl ?? currentConfig.scheduleUrl),
    managerStaffName: String(payload?.managerStaffName ?? currentConfig.managerStaffName).trim()
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return nextConfig;
}

module.exports = {
  DEFAULT_TARGET_URL,
  normalizeScheduleUrl,
  normalizeTargetUrl,
  readAppRuntimeConfig,
  writeAppRuntimeConfig,
  isFullTargetUrl,
  assertFullTargetUrl,
  resolveLoginEntryUrl,
  resolveWorkEntryUrl
};
