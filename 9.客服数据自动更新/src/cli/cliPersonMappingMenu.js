const { readProjectConfig } = require("../config/projectConfigServiceParts/projectConfigPersistence");
const { updateProjectConfig } = require("./cliProjectConfig");
const { DIVIDER } = require("./cliDashboard");

function readPersonMappings() {
  return readProjectConfig()?.globalDefaults?.reportProfiles?.performance?.personMappings || [];
}

function savePersonMappings(personMappings) {
  return updateProjectConfig((projectConfig) => {
    projectConfig.globalDefaults.reportProfiles.performance.personMappings = personMappings;
  });
}

function parseSourceNames(sourceNamesText) {
  return [...new Set(String(sourceNamesText || "").split(/[，,]/).map((item) => item.trim()).filter(Boolean))];
}

async function promptPersonMapping(terminal, existingMapping = {}) {
  const summaryName = await terminal.promptText(`汇总姓名（回车保留“${existingMapping.summaryName || "未设置"}”）：`) || existingMapping.summaryName || "";
  const roleText = await terminal.promptText(`岗位：1=售前，2=售后（当前 ${existingMapping.role || "未设置"}）：`);
  const role = roleText === "1" ? "售前" : roleText === "2" ? "售后" : existingMapping.role || "";
  const aliasesText = await terminal.promptText(`后台账号/别名，逗号分隔（回车保留“${(existingMapping.sourceNames || []).join("，") || "未设置"}”）：`);
  const sourceNames = aliasesText ? parseSourceNames(aliasesText) : existingMapping.sourceNames || [];
  if (!summaryName || !["售前", "售后"].includes(role) || !sourceNames.length) throw new Error("客服设置必须包含姓名、售前/售后岗位和至少一个后台账号或别名。 ");
  return { summaryName, role, sourceNames };
}

async function showPersonMappingMenu(terminal) {
  while (true) {
    const personMappings = readPersonMappings();
    terminal.clear(); terminal.writeLine(terminal.theme.title("客服设置")); terminal.writeLine(terminal.theme.muted(DIVIDER));
    personMappings.forEach((mapping, index) => terminal.writeLine(`  [${index + 1}] ${mapping.summaryName} · ${mapping.role} · ${(mapping.sourceNames || []).join("、")}`));
    if (!personMappings.length) terminal.writeLine("暂无客服姓名映射。 ");
    terminal.writeLine(terminal.theme.muted(DIVIDER)); terminal.writeLine("  [A] 新增客服    [0] 返回首页");
    const answer = await terminal.prompt("请选择客服：");
    if (answer === "0") return;
    if (answer === "a") {
      personMappings.push(await promptPersonMapping(terminal));
      savePersonMappings(personMappings); continue;
    }
    const mappingIndex = Number(answer) - 1;
    if (!personMappings[mappingIndex]) continue;
    terminal.writeLine("  [1] 编辑    [2] 删除    [0] 取消");
    const action = await terminal.prompt("请选择：");
    if (action === "1") {
      personMappings[mappingIndex] = await promptPersonMapping(terminal, personMappings[mappingIndex]);
      savePersonMappings(personMappings);
    }
    if (action === "2") {
      const confirmation = await terminal.prompt(`确认删除“${personMappings[mappingIndex].summaryName}”？输入 y：`);
      if (confirmation === "y") { personMappings.splice(mappingIndex, 1); savePersonMappings(personMappings); }
    }
  }
}

module.exports = { parseSourceNames, readPersonMappings, savePersonMappings, showPersonMappingMenu };
