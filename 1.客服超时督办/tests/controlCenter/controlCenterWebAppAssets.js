const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { renderHtmlTemplate } = require("../../src/controlCenter/controlCenterServer");

const webRoot = path.join(__dirname, "../../src/controlCenter/web");
const appScriptPaths = [
  "../../src/controlCenter/web/shared/requestJson.js",
  "../../src/controlCenter/web/app/00-state.js",
  "../../src/controlCenter/web/app/10-resource-usage.js",
  "../../src/controlCenter/web/app/20-customer-countdown.js",
  "../../src/controlCenter/web/app/30-workflow-feedback.js",
  "../../src/controlCenter/web/app/40-runtime-modals.js",
  "../../src/controlCenter/web/app/50-runtime-render.js",
  "../../src/controlCenter/web/app/60-actions-bootstrap.js"
].map((relativePath) => path.join(__dirname, relativePath));
const settingsHtmlPath = path.join(__dirname, "../../src/controlCenter/web/settings.html");
const settingsScriptPaths = [
  "../../src/controlCenter/web/shared/requestJson.js",
  "../../src/controlCenter/web/settings/00-state.js",
  "../../src/controlCenter/web/settings/10-feedback-request.js",
  "../../src/controlCenter/web/settings/20-keyword-editor.js",
  "../../src/controlCenter/web/settings/30-modal-state.js",
  "../../src/controlCenter/web/settings/40-form-render.js",
  "../../src/controlCenter/web/settings/50-page-load.js",
  "../../src/controlCenter/web/settings/60-actions.js",
  "../../src/controlCenter/web/settings/70-config-modal-bootstrap.js"
].map((relativePath) => path.join(__dirname, relativePath));
const styleEntryPath = path.join(__dirname, "../../src/controlCenter/web/style.css");
const logsPath = path.join(__dirname, "../../src/controlCenter/web/logs.js");
const sharedRequestJsonPath = path.join(__dirname, "../../src/controlCenter/web/shared/requestJson.js");
const customerMirrorDetailDialogPath = path.join(
  __dirname,
  "../../src/controlCenter/web/countdown/customerMirrorDetailDialog.js"
);
const customerMirrorListPath = path.join(__dirname, "../../src/controlCenter/web/countdown/customerMirrorList.js");
function readScriptBundle(scriptPaths) {
  // 这里按浏览器加载顺序拼接拆分脚本，测试继续验证完整页面行为。
  return scriptPaths.map((scriptPath) => fs.readFileSync(scriptPath, "utf8")).join("\n");
}

function readIndexHtml() {
  // 这里读取服务端最终会返回的完整首页，避免拆分片段后测试只检查到薄入口。
  return renderHtmlTemplate(webRoot, "index.html");
}

function readCssBundle(entryPath, visited = new Set()) {
  // 这里递归读取 CSS @import，避免拆分后测试只看到聚合入口。
  const normalizedPath = path.resolve(entryPath);
  if (visited.has(normalizedPath)) {
    return "";
  }
  visited.add(normalizedPath);
  const css = fs.readFileSync(normalizedPath, "utf8");
  const importContents = Array.from(css.matchAll(/@import url\("([^\"]+)"\);/g))
    .map((match) => readCssBundle(path.join(path.dirname(styleEntryPath), match[1].replace(/^\//, "")), visited))
    .join("\n");
  return css + "\n" + importContents;
}

const appScript = readScriptBundle(appScriptPaths);
const settingsScript = readScriptBundle(settingsScriptPaths);
// logs.js 现依赖共享 requestJson，测试 bundle 按浏览器加载顺序前置共享脚本。
const logsScript = readScriptBundle([sharedRequestJsonPath, logsPath]);
const customerMirrorDetailDialogScript = fs.readFileSync(customerMirrorDetailDialogPath, "utf8");
const customerMirrorListScript = fs.readFileSync(customerMirrorListPath, "utf8");

module.exports = {
  readIndexHtml,
  readCssBundle,
  settingsHtmlPath,
  settingsScript,
  styleEntryPath,
  logsPath,
  customerMirrorDetailDialogPath,
  customerMirrorListPath,
  appScript,
  logsScript,
  customerMirrorDetailDialogScript,
  customerMirrorListScript
};
