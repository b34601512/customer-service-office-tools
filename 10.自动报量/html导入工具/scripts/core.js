// 该文件用于初始化页面、保存全局状态并绑定主入口事件。
const MAIN_XML_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIP_XML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIP_XML_NS = "http://schemas.openxmlformats.org/package/2006/relationships";

const pageState = {
  mode: "day",
  downloadUrl: "",
  stepCount: 0,
  calendarMonth: new Date(),
  mappingRows: [],
  mappingEditIndex: -1,
  currentWorkflowStep: 1,
  workflowCompletedSteps: new Set(),
  workflowWarningSteps: new Set(),
  currentProgressPercent: 0,
  currentProgressText: "等待选择文件",
  currentImportStage: "等待开始",
  importStartedAt: "",
};

document.addEventListener("DOMContentLoaded", initializePage);

function initializePage() {
  // 该函数用于初始化页面默认值和按钮事件，保证客服打开页面就能直接使用。
  if (!window.REPORT_IMPORT_CONFIG) {
    setFatalStatus("缺少 report-config.js，无法读取料号映射。");
    return;
  }
  setSelectedDate(formatLocalDate(new Date()), "day");
  bindPageEvents();
  loadConfigForm();
  setProgress(0, "等待选择文件");
  initializeWorkflow();
  if (new URLSearchParams(window.location.search).get("selftest") === "1") {
    runSelfTest();
  }
}

function bindPageEvents() {
  // 该函数用于集中绑定页面按钮，避免事件逻辑散落到HTML里。
  document.getElementById("dateDisplayInput").addEventListener("click", openCalendarPopup);
  document.getElementById("openCalendarButton").addEventListener("click", openCalendarPopup);
  document.getElementById("calendarPrevButton").addEventListener("click", () => shiftCalendarMonth(-1));
  document.getElementById("calendarNextButton").addEventListener("click", () => shiftCalendarMonth(1));
  document.getElementById("calendarTodayButton").addEventListener("click", selectTodayInCalendar);
  document.getElementById("calendarMonthButton").addEventListener("click", selectThisMonthInCalendar);
  document.getElementById("calendarClearButton").addEventListener("click", clearCalendarSelection);
  document.addEventListener("click", closeCalendarWhenClickOutside);
  document.getElementById("runButton").addEventListener("click", runImport);
  document.getElementById("templateFileInput").addEventListener("change", handleTemplateFileChange);
  document.getElementById("csvFileInput").addEventListener("change", handleCsvFileChange);
  document.querySelectorAll("[data-workflow-step]").forEach((button) => {
    button.addEventListener("click", () => setWorkflowStep(Number(button.dataset.workflowStep)));
  });
  document.getElementById("toggleConfigButton").addEventListener("click", openConfigView);
  document.getElementById("closeConfigButton").addEventListener("click", closeConfigView);
  document.getElementById("configPanel").addEventListener("click", closeConfigWhenClickOutside);
  document.addEventListener("keydown", closeConfigWhenPressEscape);
  document.getElementById("resetConfigButton").addEventListener("click", resetConfigForm);
  document.getElementById("saveConfigButton").addEventListener("click", saveConfigForm);
  document.getElementById("toggleMappingButton").addEventListener("click", openMappingView);
  document.getElementById("closeMappingButton").addEventListener("click", closeMappingView);
  document.getElementById("mappingPanel").addEventListener("click", closeMappingWhenClickOutside);
  document.addEventListener("keydown", closeMappingWhenPressEscape);
  document.getElementById("mappingSearchInput").addEventListener("input", renderMappingList);
  document.getElementById("addMappingButton").addEventListener("click", startAddMapping);
  document.getElementById("exportMappingButton").addEventListener("click", exportMappingConfig);
  document.getElementById("saveMappingButton").addEventListener("click", saveMappingConfig);
  document.getElementById("resetMappingButton").addEventListener("click", resetMappingConfig);
  document.getElementById("mappingTableBody").addEventListener("click", handleMappingTableClick);
  document.getElementById("saveMappingEditButton").addEventListener("click", saveMappingEditor);
  document.getElementById("cancelMappingEditButton").addEventListener("click", cancelMappingEditor);
  document.getElementById("closeMappingEditorButton").addEventListener("click", cancelMappingEditor);
  document.getElementById("mappingEditorPanel").addEventListener("click", closeMappingEditorWhenClickOutside);
  document.addEventListener("keydown", closeMappingEditorWhenPressEscape);
  document.getElementById("openLogButton").addEventListener("click", openLogView);
  document.getElementById("copyLogButton").addEventListener("click", copyLogToClipboard);
  document.getElementById("closeLogButton").addEventListener("click", closeLogView);
  document.getElementById("logPanel").addEventListener("click", closeLogWhenClickOutside);
  document.addEventListener("keydown", closeLogWhenPressEscape);
}
