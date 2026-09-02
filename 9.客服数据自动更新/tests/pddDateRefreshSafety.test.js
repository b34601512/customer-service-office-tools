const assert = require("assert");
const { __test__ } = require("../src/platforms/pdd/pddDateApplier");

function testCalendarTextIsNotReportData() {
  assert.strictEqual(
    __test__.isPddReportDataText("2026年 7月 8月 一 二 三 四 五 六 日 1 2 3 4 5 6 7 近7天 近30天"),
    false
  );
}

function testCustomerPerformanceTableIsReportData() {
  assert.strictEqual(
    __test__.isPddReportDataText("客服账号 咨询人数 询单人数 最终成团人数 客服销售额 人工接待人数 店铺总计"),
    true
  );
}

function testOpenDatePanelBlocksDownloadReadiness() {
  assert.strictEqual(__test__.isPddReportReadyState({
    buttonState: { visible: true, disabled: false },
    currentSignature: "客服报表已刷新",
    signatureChanged: true,
    isLoading: false,
    datePanelOpen: true
  }), false);
}

function testEmptyReportSignatureBlocksDownloadReadiness() {
  assert.strictEqual(__test__.isPddReportReadyState({
    buttonState: { visible: true, disabled: false },
    currentSignature: "",
    signatureChanged: true,
    isLoading: false,
    datePanelOpen: false
  }), false);
}

function testClosedPanelAndChangedReportAllowDownload() {
  assert.strictEqual(__test__.isPddDatePanelClosedState({ open: false }), true);
  assert.strictEqual(__test__.isPddReportReadyState({
    buttonState: { visible: true, disabled: false },
    currentSignature: "客服报表已刷新",
    signatureChanged: true,
    isLoading: false,
    datePanelOpen: false
  }), true);
}

function run() {
  testCalendarTextIsNotReportData();
  console.log("PASS 拼多多日历文字不能冒充客服报表刷新");
  testCustomerPerformanceTableIsReportData();
  console.log("PASS 拼多多客服绩效表格可被识别为真实报表");
  testOpenDatePanelBlocksDownloadReadiness();
  console.log("PASS 拼多多日期面板未收起时禁止下载");
  testEmptyReportSignatureBlocksDownloadReadiness();
  console.log("PASS 拼多多没有真实报表内容时禁止下载");
  testClosedPanelAndChangedReportAllowDownload();
  console.log("PASS 拼多多日期面板关闭且报表刷新后允许下载");
}

run();
