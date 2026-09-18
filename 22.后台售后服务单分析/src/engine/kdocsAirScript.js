// 本文件只负责「调用金山文档里已保存的 AirScript 脚本」，不含业务判断。
// 协议来源：9号 `src/kdocsSync/kdocsAirScriptClient.js`（实战验证过）；官方文档
//   https://open.wps.cn/documents/app-integration-dev/guide/dbsheet/AirScript/script-token/AirScript-apitoken-api
//   https://developer.kdocs.cn/server/server-script/sync-script.html
//
// 要点（别随手改）：
// 1) 入口就是脚本的「同步 webhook」：POST <webhookUrl>，请求头 `AirScript-Token: <token>`，
//    参数用 body 里的 `Context.argv`（数组）传，返回值在响应体的 `data.result` 里。
// 2) AirScript-Token ≠ OAuth access_token，不能拿去调 KSheet「获取单元格」等 OpenAPI。
// 3) 脚本必须在文档里**已保存**，且只读（本项目只允许只读脚本：不给任何属性赋值、不 Save）。
const fs = require("fs");
const path = require("path");
const { projectPath } = require("../config/stores");

const CONFIG_PATH = projectPath("project-config", "kdocs-airscript.json");

function readAirScriptConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`缺少金山脚本配置：${path.relative(projectPath(), CONFIG_PATH)}（内容：{"webhookUrl":"...","apiToken":"..."}，不入库）`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!config.webhookUrl || !config.apiToken) {
    throw new Error("金山脚本配置缺少 webhookUrl 或 apiToken。");
  }
  return config;
}

async function runAirScript(contextArguments, options = {}) {
  const config = options.config || readAirScriptConfig();
  const timeoutMs = options.timeoutMilliseconds || 180000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response = null;
  let text = "";
  try {
    response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "AirScript-Token": config.apiToken },
      body: JSON.stringify({ Context: { argv: contextArguments } }),
      signal: controller.signal
    });
    text = await response.text();
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error(`金山脚本执行超过 ${Math.round(timeoutMs / 1000)} 秒未返回。`);
    throw new Error(`连接金山文档失败：${error && error.message ? error.message : error}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`金山接口返回 HTTP ${response.status}（检查 webhook 与脚本令牌是否有效）`);
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error("金山接口没有返回可解析的 JSON。");
  }
  if (payload.error) throw new Error(`金山脚本报错：${JSON.stringify(payload.error).slice(0, 300)}`);
  const raw = payload.data ? payload.data.result : payload.result;
  if (raw === undefined || raw === null || raw === "[Undefined]") {
    throw new Error("金山脚本没有返回结果（确认脚本已保存且结尾有返回值）。");
  }
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    throw new Error(`金山脚本返回值不是 JSON：${String(raw).slice(0, 200)}`);
  }
}

module.exports = { runAirScript, readAirScriptConfig, CONFIG_PATH };
