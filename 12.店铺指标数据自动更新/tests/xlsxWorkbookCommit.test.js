const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isRetryableWorkbookCommitError,
  renameWorkbookWithRetry
} = require("../src/summaryData/xlsxWorkbookEngine");

test("汇总表短暂占用时自动重试后提交", async () => {
  let renameAttemptCount = 0;
  let waitCount = 0;
  await renameWorkbookWithRetry("temporary.xlsx", "workbook.xlsx", {
    maximumAttempts: 3,
    retryDelayMs: 1,
    async renameFn() {
      renameAttemptCount += 1;
      if (renameAttemptCount < 3) {
        const error = new Error("temporary lock");
        error.code = "EPERM";
        throw error;
      }
    },
    async waitFn() { waitCount += 1; }
  });
  assert.equal(renameAttemptCount, 3);
  assert.equal(waitCount, 2);
});

test("只重试Windows文件占用错误", async () => {
  assert.equal(isRetryableWorkbookCommitError({ code: "EPERM" }), true);
  assert.equal(isRetryableWorkbookCommitError({ code: "EBUSY" }), true);
  assert.equal(isRetryableWorkbookCommitError({ code: "ENOENT" }), false);
});
