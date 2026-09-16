// 该文件用于验证「截图凭证已停用」：不再截图、不再建截图目录、不再因截图失败而报错，
// 同时纯文本凭证（失败原因、天猫页面地址）必须继续保留。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { isScreenshotEvidenceEnabled } = require("../src/shared/evidenceSettings");
const { captureDownloadEvidence } = require("../src/shared/downloadEvidence");
const { captureTmallPageCheckpoint } = require("../src/platforms/tmall/tmallSafetyGuard");
const {
  writeSummaryFailureTextEvidence,
  ensureSummaryErrorEvidence
} = require("../src/summary/configuredWorkflowParts/summaryFailureEvidence");

function createTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `evidence-off-${name}-`));
}

function createFakePage(url = "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData") {
  const calls = [];
  return {
    calls,
    url: () => url,
    screenshot: async () => {
      calls.push("screenshot");
      throw new Error("截图不应该被调用");
    }
  };
}

function testSwitchDefaultsToDisabled() {
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  assert.strictEqual(isScreenshotEvidenceEnabled(), false, "默认必须停用截图凭证");
}

async function testDownloadEvidenceDoesNothingWhenDisabled() {
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  const evidenceDir = createTempDir("download");
  const page = createFakePage();
  const evidenceFiles = [];
  const result = await captureDownloadEvidence(page, { evidenceDir, evidenceFiles }, "京东业绩指标下载前");
  assert.strictEqual(result, "", "停用后应返回空路径");
  assert.deepStrictEqual(page.calls, [], "停用后不允许调用 page.screenshot");
  assert.deepStrictEqual(evidenceFiles, [], "停用后不允许登记截图凭证");
  assert.strictEqual(fs.existsSync(path.join(evidenceDir, "")), true);
  assert.deepStrictEqual(fs.readdirSync(evidenceDir), [], "停用后不允许生成任何截图文件");
}

async function testDownloadEvidenceWorksWhenEnabledByEnv() {
  process.env.PI_EVIDENCE_SCREENSHOTS = "1";
  try {
    assert.strictEqual(isScreenshotEvidenceEnabled(), true, "环境变量应为可恢复的开关");
    const evidenceDir = createTempDir("download-on");
    const page = createFakePage();
    let capturedPath = "";
    page.screenshot = async (options) => {
      capturedPath = options.path;
      fs.writeFileSync(options.path, "png");
    };
    const result = await captureDownloadEvidence(page, { evidenceDir }, "京东业绩指标下载前");
    assert.strictEqual(result, capturedPath);
    assert.strictEqual(fs.existsSync(capturedPath), true, "开关打开时仍应能截图");
  } finally {
    delete process.env.PI_EVIDENCE_SCREENSHOTS;
  }
}

async function testTmallCheckpointKeepsPageUrlButNoScreenshot() {
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  const page = createFakePage("https://myseller.taobao.com/home.htm");
  const result = await captureTmallPageCheckpoint(page, "天猫1店-目标页加载后");
  assert.strictEqual(result.screenshotPath, "", "停用后不应生成天猫截图");
  assert.strictEqual(page.calls.length, 0, "停用后不允许调用 page.screenshot");
  assert.strictEqual(fs.existsSync(result.metadataPath), true, "页面地址文本必须保留");
  const metadata = JSON.parse(fs.readFileSync(result.metadataPath, "utf8"));
  assert.strictEqual(metadata.pageUrl, "https://myseller.taobao.com/home.htm");
  assert.strictEqual(metadata.checkpoint, "天猫1店-目标页加载后");
}

async function testFailureEvidenceFallsBackToTextFile() {
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  const evidenceDir = createTempDir("failure");
  const evidenceFiles = [];
  const filePath = writeSummaryFailureTextEvidence(
    evidenceDir,
    { storeDisplayName: "京东6店", platformLabel: "京东" },
    "当前店铺目标页仍未就绪",
    evidenceFiles
  );
  assert.strictEqual(fs.existsSync(filePath), true, "失败原因文本必须落盘");
  assert.strictEqual(path.extname(filePath), ".txt");
  assert.match(fs.readFileSync(filePath, "utf8"), /京东6店/);
  assert.match(fs.readFileSync(filePath, "utf8"), /目标页仍未就绪/);
  assert.deepStrictEqual(evidenceFiles.map((item) => item.label), ["失败原因"]);
  const pngFiles = fs.readdirSync(evidenceDir).filter((name) => name.endsWith(".png"));
  assert.deepStrictEqual(pngFiles, [], "停用后失败路径也不允许留截图");
}

async function testEnsureSummaryErrorEvidenceNeverTouchesBrowserWhenDisabled() {
  delete process.env.PI_EVIDENCE_SCREENSHOTS;
  const projectRoot = createTempDir("project");
  let waitForPortCalled = false;
  const evidenceFiles = await ensureSummaryErrorEvidence(
    { platformLabel: "京东", platformKey: "jd", storeDisplayName: "京东6店", storeKey: "jd6" },
    new Error("Target page, context or browser has been closed"),
    projectRoot,
    {
      waitForChromeDebugPortReady: async () => {
        waitForPortCalled = true;
        return true;
      }
    }
  );
  assert.strictEqual(waitForPortCalled, false, "停用后不应再连接浏览器采集失败现场");
  assert.strictEqual(evidenceFiles.length, 1);
  assert.strictEqual(evidenceFiles[0].label, "失败原因");
  assert.strictEqual(fs.existsSync(evidenceFiles[0].filePath), true);
  assert.match(evidenceFiles[0].filePath, /runtime[\\/]evidence[\\/]summary/);
}

async function main() {
  const tests = [
    testSwitchDefaultsToDisabled,
    testDownloadEvidenceDoesNothingWhenDisabled,
    testDownloadEvidenceWorksWhenEnabledByEnv,
    testTmallCheckpointKeepsPageUrlButNoScreenshot,
    testFailureEvidenceFallsBackToTextFile,
    testEnsureSummaryErrorEvidenceNeverTouchesBrowserWhenDisabled
  ];
  for (const test of tests) {
    await test();
    console.log(`  ✓ ${test.name}`);
  }
  console.log("evidenceScreenshotsDisabled 全部通过");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
