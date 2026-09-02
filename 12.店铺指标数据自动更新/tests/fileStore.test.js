const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  isRetryableFileRenameError,
  renameFileWithRetry
} = require("../src/shared/fileStore");

test("读取店铺配置不会触发文件写入", () => {
  const projectRoot = path.join(__dirname, "..");
  const childScript = [
    "const fs = require('fs');",
    "let renameAttemptCount = 0;",
    "fs.renameSync = () => { renameAttemptCount += 1; throw new Error('读取配置不应调用重命名'); };",
    "require('./src/config/storeMetricConfig').readStoreMetricConfig();",
    "process.stdout.write(String(renameAttemptCount));"
  ].join(" ");
  const result = spawnSync(process.execPath, ["-e", childScript], {
    cwd: projectRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "0");
});

test("配置文件短暂占用时自动重试后替换", () => {
  let renameAttemptCount = 0;
  let waitCount = 0;
  renameFileWithRetry("temporary.json", "config.json", {
    maximumAttempts: 3,
    retryDelayMs: 1,
    renameFn() {
      renameAttemptCount += 1;
      if (renameAttemptCount < 3) {
        const error = new Error("temporary lock");
        error.code = "EPERM";
        throw error;
      }
    },
    waitFn() {
      waitCount += 1;
    }
  });
  assert.equal(renameAttemptCount, 3);
  assert.equal(waitCount, 2);
});

test("只把Windows文件占用错误视为可重试", () => {
  assert.equal(isRetryableFileRenameError({ code: "EPERM" }), true);
  assert.equal(isRetryableFileRenameError({ code: "EBUSY" }), true);
  assert.equal(isRetryableFileRenameError({ code: "EACCES" }), true);
  assert.equal(isRetryableFileRenameError({ code: "ENOENT" }), false);
});
