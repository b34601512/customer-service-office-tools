const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  buildEvidenceFileName,
  buildStoreMetricEvidenceDirectoryName,
  normalizeEvidenceFiles,
  mergeEvidenceFiles
} = require("../src/shared/evidenceFiles");

test("凭证目录和文件名包含可读的店铺、平台、时间和结果信息", () => {
  assert.equal(
    buildStoreMetricEvidenceDirectoryName({
      timestampText: "2026-08-05-10-05-45",
      platformKey: "jd",
      storeDisplayName: "京东1店",
      storeKey: "jd1"
    }),
    "2026-08-05-10-05-45-京东-京东1店-jd1"
  );
  assert.equal(
    buildEvidenceFileName({
      evidenceLabel: "店铺星级",
      resultLabel: "读取成功",
      fileExtension: "png"
    }),
    "店铺星级-读取成功.png"
  );
  assert.equal(
    buildEvidenceFileName({
      evidenceLabel: "失败原因",
      resultLabel: "2026-08-05-10-06-51",
      fileExtension: "txt"
    }),
    "失败原因-2026-08-05-10-06-51.txt"
  );
});

test("凭证统一为带名称和绝对路径的结构，空路径与重复路径会被剔除", () => {
  const firstFilePath = path.join(__dirname, "fixtures", "页面截图.png");
  const secondFilePath = path.join(__dirname, "fixtures", "失败原因.txt");
  const normalizedFiles = normalizeEvidenceFiles([
    "",
    firstFilePath,
    { label: "重复截图", filePath: firstFilePath },
    { label: "登录失败原因", filePath: secondFilePath }
  ]);
  assert.equal(normalizedFiles.length, 2);
  assert.equal(normalizedFiles[0].label, "页面凭证1");
  assert.equal(normalizedFiles[0].filePath, path.resolve(firstFilePath));
  assert.equal(normalizedFiles[1].label, "登录失败原因");
  assert.equal(normalizedFiles[1].filePath, path.resolve(secondFilePath));
  assert.deepEqual(mergeEvidenceFiles(normalizedFiles, normalizedFiles), normalizedFiles);
});
