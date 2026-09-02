const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const {
  readStoreMetricConfig,
  saveStoreMetricConfig
} = require("../config/storeMetricConfig");
const {
  openLocalFile,
  openExternalUrl
} = require("../controlCenter/localFileApiParts/windowsLocalFileActions");
const {
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl,
  isKdocsSyncConfigured
} = require("../kdocsSync/kdocsSyncSettings");
const { syncDataSourceToKdocs } = require("../kdocsSync/syncDataSourceToKdocs");
const { DIVIDER } = require("./cliDashboard");

const airScriptSyncTemplatePath = path.join(
  appConfig.projectRoot,
  "src",
  "kdocsSync",
  "AirScript-写入数据源.txt"
);
function renderKdocsSyncInstructions(terminal, projectConfig) {
  const syncSettings = projectConfig.kdocsDataSourceSync || {};
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(`同步：${isKdocsSyncConfigured(syncSettings) ? "已配置" : "未配置"}`);
  terminal.writeLine(`本地来源：${projectConfig.workbook.path || "未设置"}`);
  terminal.writeLine(`在线文档：${syncSettings.documentUrl || "未设置"}`);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(terminal.theme.heading("  操作"));
  terminal.writeLine("  [1] 一键同步数据源");
  terminal.writeLine();
  terminal.writeLine(terminal.theme.heading("  脚本"));
  terminal.writeLine("  [2] 打开数据源脚本");
  terminal.writeLine();
  terminal.writeLine(terminal.theme.heading("  其他"));
  terminal.writeLine("  [3] 修改同步设置");
  terminal.writeLine("  [4] 打开在线文档");
  terminal.writeLine("  [0] 返回");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

function renderKdocsSyncHelpInstructions(terminal, projectConfig) {
  const syncSettings = projectConfig.kdocsDataSourceSync || {};
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步 · 首次配置说明"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(terminal.theme.heading("  当前状态"));
  terminal.writeLine(`  数据源脚本：${isKdocsSyncConfigured(syncSettings) ? "已配置" : "未配置"}`);
  terminal.writeLine(`  本地来源：${projectConfig.workbook.path || "未设置"}`);
  terminal.writeLine(`  在线文档：${syncSettings.documentUrl || "未设置"}`);
  terminal.writeLine();
  terminal.writeLine(terminal.theme.heading("  首次配置步骤"));
  terminal.writeLine("  1. 打开目标文档，确认有\"数据源\"工作表。 ");
  terminal.writeLine("  2. 点：效率 → 高级开发 → AirScript脚本编辑器。 ");
  terminal.writeLine("  3. 新建一个文档共享脚本，把[2]数据源脚本全选粘贴后保存。 ");
  terminal.writeLine("  4. 为该脚本生成脚本令牌，复制 webhook。 ");
  terminal.writeLine("  5. 选择[3]填写 webhook/令牌，再用[1]同步数据源。 ");
  terminal.writeLine("  6. 数据源只有一个采集日期，同步完成即结束。 ");
  terminal.writeLine("  令牌等同密码，只保存在本机，不要发给别人。 ");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("  [0] 返回");
}

async function showKdocsSyncSettingsMenu(terminal) {
  const currentConfig = readStoreMetricConfig();
  const currentSettings = currentConfig.kdocsDataSourceSync || {};
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步设置"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("直接回车保留原值；令牌输入时不会显示。 ");
  terminal.writeLine(`当前文档：${currentSettings.documentUrl || "未设置"}`);
  const documentUrlInput = await terminal.promptText("在线文档分享地址：");
  const syncWebhookUrlInput = await terminal.promptText("数据源脚本 webhook（菜单[1]）：");
  const syncApiTokenInput = await terminal.promptSecret("数据源脚本令牌（菜单[1]）：");
  const nextDocumentUrl = documentUrlInput
    ? requireValidKdocsDocumentUrl(documentUrlInput)
    : currentSettings.documentUrl;
  const nextSyncWebhookUrl = syncWebhookUrlInput
    ? requireValidKdocsWebhookUrl(syncWebhookUrlInput)
    : currentSettings.webhookUrl;
  if (!documentUrlInput && !syncWebhookUrlInput && !syncApiTokenInput) return;
  saveStoreMetricConfig({
    kdocsDataSourceSync: {
      documentUrl: nextDocumentUrl || "",
      webhookUrl: nextSyncWebhookUrl || "",
      apiToken: syncApiTokenInput || currentSettings.apiToken || ""
    }
  });
  terminal.writeLine(terminal.theme.success("同步设置已保存。 "));
  await terminal.pause();
}

async function runKdocsDataSourceSync(terminal) {
  const projectConfig = readStoreMetricConfig();
  terminal.clear();
  terminal.writeLine(terminal.theme.title("正在同步金山文档"));
  terminal.writeLine("正在清空在线\"数据源\"并从A1镜像本地，请稍候……");
  const syncResult = await syncDataSourceToKdocs({ projectConfig });
  terminal.writeLine(terminal.theme.success(
    `\n金山文档镜像完成：${syncResult.remoteDataRowCount} 行，在线与本地逐格一致。 `
  ));
  await terminal.pause();
}

async function openAirScriptTemplate(templatePath) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`找不到 AirScript 脚本文件：${templatePath}`);
  }
  await openLocalFile(templatePath);
}

async function openConfiguredKdocsDocument() {
  const documentUrl = requireValidKdocsDocumentUrl(
    readStoreMetricConfig().kdocsDataSourceSync?.documentUrl
  );
  await openExternalUrl(documentUrl);
}

async function showKdocsSyncMenu(terminal) {
  while (true) {
    renderKdocsSyncInstructions(terminal, readStoreMetricConfig());
    const selection = await terminal.prompt("请选择：");
    if (selection === "0") return;
    if (selection === "1") await runKdocsDataSourceSync(terminal);
    if (selection === "2") await openAirScriptTemplate(airScriptSyncTemplatePath);
    if (selection === "3") await showKdocsSyncSettingsMenu(terminal);
    if (selection === "4") await openConfiguredKdocsDocument();
  }
}

module.exports = {
  airScriptTemplatePath: airScriptSyncTemplatePath,
  renderKdocsSyncInstructions,
  showKdocsSyncSettingsMenu,
  runKdocsDataSourceSync,
  showKdocsSyncMenu
};
