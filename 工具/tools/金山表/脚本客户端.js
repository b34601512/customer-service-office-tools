// 金山 AirScript 脚本客户端（只读）：调用金山文档里已保存的 AirScript 脚本，不含业务判断。
//
// ⚠ 2026-09-30 收拢：**唯一出处**。22/24/25 号原来各有一份逐字相同的 `src/engine/kdocsAirScript.js`（95 行 ×3），
//    现在都改成薄壳：`创建脚本客户端({ 项目根, log })`（见各项目 `src/engine/kdocsAirScript.js`）。
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

/** 造一份脚本客户端：配置放 <项目根>/project-config/kdocs-airscript.json（不入库）。 */
function 创建脚本客户端({ 项目根, log = () => {} } = {}) {
  if (!项目根) throw new Error("创建脚本客户端需要传 项目根（用来定位 project-config/kdocs-airscript.json）");
  const CONFIG_PATH = path.join(项目根, "project-config", "kdocs-airscript.json");

  function readAirScriptConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
      throw new Error(`缺少金山脚本配置：${path.relative(项目根, CONFIG_PATH)}（内容：{"webhookUrl":"...","apiToken":"..."}，不入库）`);
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    if (!config.apiToken) {
      // 2026-09-18 实测：同一金山账号下的 AirScript-Token 可跨脚本使用（拿 12号 的令牌调本文档的同步 webhook 返回 HTTP 200），
      // 所以本地缺令牌时沿用 12号 那份；以后若失效，把令牌直接填进 project-config/kdocs-airscript.json 即可。
      const fallbackRelative = config.apiTokenFallbackFile || "../12.店铺指标数据自动更新/project-config/platform-config.json";
      const fallbackPath = path.resolve(项目根, fallbackRelative);   // fallbackRelative 相对本项目根
      if (fs.existsSync(fallbackPath)) {
        const fallbackConfig = JSON.parse(fs.readFileSync(fallbackPath, "utf8"));
        const adapter = fallbackConfig.kdocsDataSourceSync || {};
        if (adapter.apiToken) config.apiToken = adapter.apiToken;
      }
    }
    if (!config.apiToken) {
      throw new Error("缺少金山脚本令牌：请把 AirScript-Token 填进 project-config/kdocs-airscript.json 的 apiToken。");
    }
    return config;
  }

  function resolveWebhook(scriptName, config) {
    const entry = config.scripts && config.scripts[scriptName] ? config.scripts[scriptName] : null;
    if (entry && entry.webhookUrl) return entry.webhookUrl;
    // 旧结构（只有一个顶层 webhookUrl）当作默认脚本 "query" 处理，保持向后兼容
    if (scriptName === "query" && config.webhookUrl) return config.webhookUrl;
    const available = Object.keys(config.scripts || {}).join(", ") || "(空)";
    throw new Error(`配置里没有脚本「${scriptName}」的 webhook（现有：${available}）——把该脚本的同步地址填进 project-config/kdocs-airscript.json 的 scripts.<名字>.webhookUrl`);
  }

  async function runAirScript(contextArguments, options = {}) {
    const config = options.config || readAirScriptConfig();
    const scriptName = options.script || "query";
    const webhookUrl = options.webhookUrl || resolveWebhook(scriptName, config);
    const timeoutMs = options.timeoutMilliseconds || 180000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response = null;
    let text = "";
    try {
      response = await fetch(webhookUrl, {
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
    if (payload.error) {
      // 金山会把脚本内部的 SyntaxError/RuntimeError 连行号一起放在 error_details.stack 里，排障时必须带上（否则只知道“有错”）。
      const stack = payload.error_details && Array.isArray(payload.error_details.stack) ? payload.error_details.stack.join(" ").slice(0, 300) : "";
      throw new Error(`金山脚本报错：${String(payload.error).slice(0, 200)}${stack ? ` ← ${stack}` : ""}`);
    }
    const raw = payload.data ? payload.data.result : payload.result;
    if (raw === undefined || raw === null || raw === "[Undefined]") {
      throw new Error("金山脚本没有返回结果：确认脚本已保存，且**最后一行是 return main()**（只写 main() 平台拿不到返回值，2026-09-18 实测）。");
    }
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(String(raw));
    } catch (error) {
      throw new Error(`金山脚本返回值不是 JSON：${String(raw).slice(0, 200)}`);
    }
  }

  return { runAirScript, readAirScriptConfig, resolveWebhook, CONFIG_PATH };
}

module.exports = { 创建脚本客户端 };
