const fs = require("fs");
const path = require("path");
const appConfig = require("../config/appConfig");
const { readProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { patchControlCenterState } = require("../controlCenter/controlCenterState");
const { openLocalFile, openExternalUrl } = require("../controlCenter/localFileApiParts/windowsLocalFileActions");
const {
  requireValidKdocsDocumentUrl,
  requireValidKdocsWebhookUrl,
  isKdocsSyncConfigured
} = require("../kdocsSync/kdocsSyncSettings");
const { syncDataDetailToKdocs } = require("../kdocsSync/syncDataDetailToKdocs");
const { updateKdocsPivotEndDateFilter } = require("../kdocsSync/updateKdocsPivotEndDateFilter");
const {
  reapplyKdocsCustomerServiceNameFilter
} = require("../kdocsSync/reapplyKdocsCustomerServiceNameFilter");
const { updateProjectConfig } = require("./cliProjectConfig");
const { DIVIDER } = require("./cliDashboard");

const airScriptSyncTemplatePath = path.join(appConfig.projectRoot, "src", "kdocsSync", "AirScript-同步数据明细.txt");
const airScriptFilterTemplatePath = path.join(appConfig.projectRoot, "src", "kdocsSync", "AirScript-筛选透视结果.txt");
const airScriptCustomerServiceNameTemplatePath = path.join(appConfig.projectRoot, "src", "kdocsSync", "AirScript-原样确认客服姓名勾选.txt");
const airScriptTemplatePath = airScriptSyncTemplatePath;

const KDOCS_MENU_BOX_WIDTH = DIVIDER.length;
const KDOCS_MENU_CONTENT_WIDTH = KDOCS_MENU_BOX_WIDTH - 4;

function getKdocsDisplayWidth(value) {
  return [...String(value ?? "")].reduce(
    (width, character) => width + (/[^\x00-\xff]/.test(character) ? 2 : 1),
    0
  );
}

function wrapKdocsLine(value) {
  const text = String(value ?? "");
  if (!text) return [""];
  const lines = [];
  let currentLine = "";
  let currentWidth = 0;
  for (const character of text) {
    const characterWidth = getKdocsDisplayWidth(character);
    if (currentLine && currentWidth + characterWidth > KDOCS_MENU_CONTENT_WIDTH) {
      lines.push(currentLine);
      currentLine = "";
      currentWidth = 0;
    }
    currentLine += character;
    currentWidth += characterWidth;
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function writeKdocsSection(terminal, title, lines) {
  const border = "─".repeat(KDOCS_MENU_BOX_WIDTH - 2);
  const formatRow = (value) => {
    const text = String(value ?? "");
    const padding = Math.max(0, KDOCS_MENU_CONTENT_WIDTH - getKdocsDisplayWidth(text));
    return `│ ${text}${" ".repeat(padding)} │`;
  };
  terminal.writeLine(terminal.theme.muted(`┌${border}┐`));
  terminal.writeLine(terminal.theme.heading(formatRow(title)));
  terminal.writeLine(terminal.theme.muted(`├${border}┤`));
  lines.forEach((line) => {
    wrapKdocsLine(line).forEach((wrappedLine, lineIndex) => {
      terminal.writeLine(formatRow(`${lineIndex ? "  " : ""}${wrappedLine}`));
    });
  });
  terminal.writeLine(terminal.theme.muted(`└${border}┘`));
}

function renderKdocsSyncInstructions(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步与透视筛选"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine(terminal.theme.heading("  操作"));
  terminal.writeLine("  [1] 一键同步明细");
  terminal.writeLine("  [2] 重设\"透视结果\"筛选日期（回车=数据最新日期）");
  terminal.writeLine("  [3] 原样确认客服姓名勾选");
  terminal.writeLine();
  terminal.writeLine(terminal.theme.heading("  脚本"));
  terminal.writeLine("  [4] 打开同步脚本");
  terminal.writeLine("  [5] 打开筛选脚本");
  terminal.writeLine("  [6] 打开客服姓名脚本");
  terminal.writeLine();
  terminal.writeLine(terminal.theme.heading("  其他"));
  terminal.writeLine("  [7] 修改同步设置");
  terminal.writeLine("  [8] 打开在线文档");
  terminal.writeLine("  [H] 状态与首次配置说明");
  terminal.writeLine("  [0] 返回");
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

function renderKdocsSyncStatusInstructions(terminal, projectConfig) {
  const syncSettings = projectConfig.kdocsDataDetailSync || {};
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步 · 状态与首次配置"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  const syncReady = isKdocsSyncConfigured(syncSettings, "sync");
  const filterReady = isKdocsSyncConfigured(syncSettings, "filter");
  const customerServiceNameReady = isKdocsSyncConfigured(syncSettings, "customerServiceName");
  writeKdocsSection(terminal, "当前状态", [
    `状态：同步${syncReady ? "已配置" : "未配置"}，` +
      `筛选${filterReady ? "已配置" : "未配置"}，` +
      `客服姓名${customerServiceNameReady ? "已配置" : "未配置"}`,
    `本地来源：${projectConfig.workbook.path || "未设置"}`,
    `在线文档：${syncSettings.documentUrl || "未设置"}`,
    `同步 webhook（菜单[1]）：${syncReady ? "已保存" : "未设置"}`,
    `筛选 webhook（菜单[2]）：${filterReady ? "已保存" : "未设置"}`,
    `客服姓名 webhook（菜单[3]）：${customerServiceNameReady ? "已保存" : "未设置"}`
  ]);
  terminal.writeLine();
  writeKdocsSection(terminal, "功能说明", [
    "一键同步：把本地“数据明细”A:X共24列（含表头）",
    "全量覆盖在线同名工作表并整表回读核对。 ",
    "脚本不要求、不创建正规数据表；认到唯一的“数据明细”工作表后，",
    "固定覆盖A:X动态数据区。 ",
    "客服姓名确认：先读取每张透视表的原勾选，再原样重应用，",
    "最后刷新并保存，不改变勾选结果。 ",
    "用途：解决金山文档仪表盘刷新 BUG；日期筛选后必须单独执行[3]。 ",
    "详细接入说明：src/kdocsSync/AirScript-客服姓名确认说明.md（issue #522）。 ",
    "同步回执：脱敏保存到 runtime/state/history/",
    "kdocs-sync-receipts.json，重启后仍可追溯。 "
  ]);
  terminal.writeLine();
  writeKdocsSection(terminal, "首次配置步骤", [
    "1. 打开目标文档，确认有唯一的“数据明细”和“透视结果”工作表；",
    "   在线“数据明细”现有内容会被A:X全量覆盖。 ",
    "2. 依次点：效率 → 高级开发 → AirScript脚本编辑器。 ",
    "3. 新建三个“文档共享脚本”：把[4]同步脚本、[5]筛选脚本、",
    "   [6]客服姓名脚本分别全选粘贴，分别按 Ctrl+S 保存。 ",
    "4. 为三个共享脚本分别生成脚本令牌，并从各自脚本复制",
    "   webhook；三组不能混用。 ",
    "5. 选择[7]填写三组设置；按[1]、[2]、[3]手动分步执行",
    "   三个动作。 ",
    "如曾粘贴旧版合并脚本，请三个新脚本都重新全选覆盖并保存。 ",
    "注意：三个 webhook 都必须从同一份目标文档复制，令牌等同密码，",
    "只保存在本机。 "
  ]);
  terminal.writeLine();
  writeKdocsSection(terminal, "返回", [
    "  [0] 返回菜单"
  ]);
  terminal.writeLine(terminal.theme.muted(DIVIDER));
}

async function showKdocsSyncSettingsMenu(terminal) {
  const currentConfig = readProjectConfig();
  const currentSettings = currentConfig.kdocsDataDetailSync || {};
  terminal.clear();
  terminal.writeLine(terminal.theme.title("金山文档同步设置"));
  terminal.writeLine(terminal.theme.muted(DIVIDER));
  terminal.writeLine("直接回车保留原值；脚本令牌输入时不会显示。三组 webhook/令牌分别对应菜单[1]、[2]和[3]。 ");
  terminal.writeLine(`当前文档：${currentSettings.documentUrl || "未设置"}`);
  const documentUrlInput = await terminal.promptText("在线文档分享地址：");
  const syncWebhookUrlInput = await terminal.promptText("同步脚本 webhook（菜单[1]）：");
  const syncApiTokenInput = await terminal.promptSecret("同步脚本令牌（菜单[1]）：");
    const filterWebhookUrlInput = await terminal.promptText("筛选脚本 webhook（菜单[2]）：");
    const filterApiTokenInput = await terminal.promptSecret("筛选脚本令牌（菜单[2]）：");
    const customerServiceNameWebhookUrlInput = await terminal.promptText("客服姓名脚本 webhook（菜单[3]）：");
    const customerServiceNameApiTokenInput = await terminal.promptSecret("客服姓名脚本令牌（菜单[3]）：");

  const nextDocumentUrl = documentUrlInput
    ? requireValidKdocsDocumentUrl(documentUrlInput)
    : currentSettings.documentUrl;
  const nextSyncWebhookUrl = syncWebhookUrlInput
    ? requireValidKdocsWebhookUrl(syncWebhookUrlInput)
    : currentSettings.syncWebhookUrl;
  const nextFilterWebhookUrl = filterWebhookUrlInput
    ? requireValidKdocsWebhookUrl(filterWebhookUrlInput)
    : currentSettings.filterWebhookUrl;
  const nextCustomerServiceNameWebhookUrl = customerServiceNameWebhookUrlInput
    ? requireValidKdocsWebhookUrl(customerServiceNameWebhookUrlInput)
    : currentSettings.customerServiceNameWebhookUrl;
  if (
    !documentUrlInput &&
    !syncWebhookUrlInput &&
    !syncApiTokenInput &&
    !filterWebhookUrlInput &&
    !filterApiTokenInput &&
    !customerServiceNameWebhookUrlInput &&
    !customerServiceNameApiTokenInput
  ) return;
  updateProjectConfig((draftConfig) => {
    draftConfig.kdocsDataDetailSync = {
      documentUrl: nextDocumentUrl || "",
      syncWebhookUrl: nextSyncWebhookUrl || "",
      syncApiToken: syncApiTokenInput || currentSettings.syncApiToken || "",
      filterWebhookUrl: nextFilterWebhookUrl || "",
      filterApiToken: filterApiTokenInput || currentSettings.filterApiToken || "",
      customerServiceNameWebhookUrl: nextCustomerServiceNameWebhookUrl || "",
      customerServiceNameApiToken: customerServiceNameApiTokenInput || currentSettings.customerServiceNameApiToken || ""
    };
  });
  terminal.writeLine(terminal.theme.success("同步设置已保存。 "));
  await terminal.pause();
}

async function runKdocsDataDetailSync(terminal) {
  const projectConfig = readProjectConfig();
  terminal.clear();
  terminal.writeLine(terminal.theme.title("正在同步金山文档"));
  terminal.writeLine("正在写入、保存并真实回读，请稍候……");
  const syncResult = await syncDataDetailToKdocs({ projectConfig });
  const resultText = `金山文档同步完成：在线真实回读${syncResult.remoteDataRowCount}行`;
  patchControlCenterState({ lastAction: resultText, lastError: "" });
  terminal.writeLine(terminal.theme.success(`\n${resultText}。 `));
  if (syncResult.clearedTailRowCount) {
    terminal.writeLine(`同时清除了旧数据多出的 ${syncResult.clearedTailRowCount} 行。 `);
  }
  await terminal.pause();
}

async function runKdocsPivotEndDateFilterUpdate(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("修改在线透视筛选日期"));
  terminal.writeLine("回车采用本地“数据明细”的最新“统计结束日”；填写时采用自定义日期。 ");
  const filterDate = await terminal.promptText("筛选日期（回车=数据最新日期；填写 YYYY-MM-DD=自定义）：");
  terminal.writeLine("正在执行，请稍候……");
  const updateResult = await updateKdocsPivotEndDateFilter({
    projectConfig: readProjectConfig(),
    filterDate
  });
  if (updateResult.failedPivotTableCount) {
    const resultText = (
      `透视筛选未全部完成（目标${updateResult.filterDate}）：` +
      `成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个`
    );
    const failureText = `有${updateResult.failedPivotTableCount}个透视表失败`;
    patchControlCenterState({ lastAction: resultText, lastError: failureText });
    terminal.writeLine(terminal.theme.error(`\n${resultText}，${failureText}。 `));
    updateResult.failedPivotTables.forEach((failedPivotTable) => {
      terminal.writeLine(
        `第${failedPivotTable.pivotTableIndex}个：${failedPivotTable.errorMessage || "未知错误"}`
      );
    });
  } else {
    const resultText = (
      `透视筛选已设为${updateResult.filterDate}：` +
      `成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个`
    );
    patchControlCenterState({ lastAction: resultText, lastError: "" });
    terminal.writeLine(terminal.theme.success(`\n${resultText}。 `));
  }
  await terminal.pause();
}

async function runKdocsCustomerServiceNameFilterReapply(terminal) {
  terminal.clear();
  terminal.writeLine(terminal.theme.title("原样确认客服姓名勾选"));
  terminal.writeLine("先读取每张透视表的客服姓名勾选，再原样重应用，刷新并保存，请稍候……");
  const updateResult = await reapplyKdocsCustomerServiceNameFilter({
    projectConfig: readProjectConfig()
  });
  const resultText = (
    `客服姓名勾选已原样确认：成功${updateResult.successfulPivotTableCount}/${updateResult.pivotTableCount}个透视表`
  );
  if (updateResult.failedPivotTableCount) {
    const failureText = `有${updateResult.failedPivotTableCount}个透视表失败`;
    patchControlCenterState({ lastAction: resultText, lastError: failureText });
    terminal.writeLine(terminal.theme.error(`\n${resultText}，${failureText}。 `));
    updateResult.failedPivotTables.forEach((failedPivotTable) => {
      terminal.writeLine(
        `第${failedPivotTable.pivotTableIndex}个：${failedPivotTable.errorMessage || "未知错误"}`
      );
    });
  } else {
    patchControlCenterState({ lastAction: resultText, lastError: "" });
    terminal.writeLine(terminal.theme.success(`\n${resultText}。 `));
  }
  await terminal.pause();
}

async function openAirScriptTemplate(templatePath = airScriptSyncTemplatePath) {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`找不到 AirScript 脚本文件：${templatePath}`);
  }
  await openLocalFile(templatePath);
}

async function openConfiguredKdocsDocument() {
  const documentUrl = requireValidKdocsDocumentUrl(
    readProjectConfig().kdocsDataDetailSync?.documentUrl
  );
  await openExternalUrl(documentUrl);
}

async function showKdocsSyncMenu(terminal) {
  while (true) {
    renderKdocsSyncInstructions(terminal);
    const selection = await terminal.prompt("请选择：");
    if (selection === "0") return;
    if (selection === "h") {
      renderKdocsSyncStatusInstructions(terminal, readProjectConfig());
      await terminal.pause();
      continue;
    }
    if (selection === "1") await runKdocsDataDetailSync(terminal);
    if (selection === "2") await runKdocsPivotEndDateFilterUpdate(terminal);
    if (selection === "3") await runKdocsCustomerServiceNameFilterReapply(terminal);
    if (selection === "4") await openAirScriptTemplate(airScriptSyncTemplatePath);
    if (selection === "5") await openAirScriptTemplate(airScriptFilterTemplatePath);
    if (selection === "6") await openAirScriptTemplate(airScriptCustomerServiceNameTemplatePath);
    if (selection === "7") await showKdocsSyncSettingsMenu(terminal);
    if (selection === "8") await openConfiguredKdocsDocument();
  }
}

module.exports = {
  airScriptTemplatePath,
  airScriptSyncTemplatePath,
  airScriptFilterTemplatePath,
  airScriptCustomerServiceNameTemplatePath,
  renderKdocsSyncInstructions,
  renderKdocsSyncStatusInstructions,
  showKdocsSyncSettingsMenu,
  runKdocsDataDetailSync,
  runKdocsPivotEndDateFilterUpdate,
  runKdocsCustomerServiceNameFilterReapply,
  showKdocsSyncMenu
};
