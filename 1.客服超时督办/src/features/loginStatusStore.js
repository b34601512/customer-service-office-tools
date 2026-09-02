const fs = require("fs");
const path = require("path");
const { readJsonObjectSafe } = require("../engine/safeJson");

function buildUnknownLoginStatus() {
  // 该函数用于提供未验证登录态的稳定结构，避免前端猜字段。
  return {
    status: "unknown",
    isValid: false,
    verifiedAt: "",
    targetUrl: "",
    source: "",
    detail: "登录态尚未验证。"
  };
}

function readLoginStatus(statusPath) {
  // 该函数用于读取最近一次真实登录态验证结果，首页只根据这份记录展示第一步状态。
  const payload = readJsonObjectSafe(statusPath, buildUnknownLoginStatus, "登录态状态");
  const status = String(payload.status || "unknown");
  return {
    status,
    isValid: status === "valid",
    verifiedAt: String(payload.verifiedAt || ""),
    targetUrl: String(payload.targetUrl || ""),
    source: String(payload.source || ""),
    detail: String(payload.detail || (status === "valid" ? "登录态已验证有效。" : "登录态需要重新验证。"))
  };
}

function writeLoginStatus(statusPath, payload) {
  // 该函数用于统一写入登录态验证结果，避免界面和运行流程各自维护状态。
  const nextStatus = {
    status: String(payload.status || "unknown"),
    isValid: payload.status === "valid",
    verifiedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    targetUrl: String(payload.targetUrl || ""),
    source: String(payload.source || ""),
    detail: String(payload.detail || "")
  };
  fs.mkdirSync(path.dirname(statusPath), { recursive: true });
  fs.writeFileSync(statusPath, `${JSON.stringify(nextStatus, null, 2)}\n`, "utf8");
  return nextStatus;
}

function markLoginStatusValid(statusPath, payload = {}) {
  // 该函数只在真实页面校验通过后标记有效，避免把存在登录文件误判为可用登录态。
  return writeLoginStatus(statusPath, {
    ...payload,
    status: "valid",
    detail: payload.detail || "登录记录已验证有效，可以直接后台启动。"
  });
}

function markLoginStatusInvalid(statusPath, payload = {}) {
  // 该函数只在页面明确命中登录失效时标记无效，让首页第一步及时提示重新登录。
  return writeLoginStatus(statusPath, {
    ...payload,
    status: "invalid",
    detail: payload.detail || "登录记录已失效，请重新执行首次登录。"
  });
}

module.exports = {
  buildUnknownLoginStatus,
  readLoginStatus,
  markLoginStatusValid,
  markLoginStatusInvalid
};
