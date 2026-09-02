const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildExplorerArguments,
  resolveWorkbookFolder
} = require("../src/controlCenter/localFileApiParts/windowsLocalFileActions");
const {
  openRecentEvidenceFolder
} = require("../src/cli/cliEvidenceMenu");

test("首页按钮打开汇总表所在文件夹", () => {
  const workbookPath = path.join(
    __dirname,
    "..",
    "outputs",
    "019fbb96-c39c-7ec1-899b-038594c1381a",
    "店铺指标数据源.xlsx"
  );
  assert.equal(resolveWorkbookFolder(workbookPath), path.dirname(path.resolve(workbookPath)));
  assert.deepEqual(buildExplorerArguments(workbookPath), ["/select,", path.resolve(workbookPath)]);
});

test("首页[6]打开凭证总文件夹，首次使用会自动准备目录", async () => {
  const evidenceRoot = path.join(
    __dirname,
    "..",
    ".codex-temporary",
    "cli-evidence-folder-test"
  );
  let openedPath = "";
  await openRecentEvidenceFolder({
    evidenceRoot,
    revealPath(targetPath) {
      openedPath = targetPath;
    }
  });
  assert.equal(openedPath, path.resolve(evidenceRoot));
  assert.equal(fs.existsSync(openedPath), true);
  assert.equal(fs.statSync(openedPath).isDirectory(), true);
  assert.deepEqual(buildExplorerArguments(openedPath), [openedPath]);
});
