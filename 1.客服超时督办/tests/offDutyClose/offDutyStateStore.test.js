const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const appConfig = require("../../src/config/appConfig");
const { createOffDutyStateStore } = require("../../src/features/offDutyClose/offDutyStateStore");

test("下班状态仓库应该支持读取和清除已完成动作", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "off-duty-state-store-"));
  const originalStatePath = appConfig.offDutyStatePath;
  appConfig.offDutyStatePath = path.join(tempRoot, "state.json");

  try {
    const store = createOffDutyStateStore();
    store.markActionCompleted("2026-03-25::易凡::早班", {
      reason: "测试完成"
    });

    assert.equal(store.isActionCompleted("2026-03-25::易凡::早班"), true);
    assert.equal(
      store.getActionCompletion("2026-03-25::易凡::早班").reason,
      "测试完成"
    );

    store.clearActionCompleted("2026-03-25::易凡::早班");
    assert.equal(store.isActionCompleted("2026-03-25::易凡::早班"), false);
    assert.equal(store.getActionCompletion("2026-03-25::易凡::早班"), null);
  } finally {
    appConfig.offDutyStatePath = originalStatePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("下班状态仓库应该支持记录和读取完成通知状态", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "off-duty-state-store-"));
  const originalStatePath = appConfig.offDutyStatePath;
  appConfig.offDutyStatePath = path.join(tempRoot, "state.json");

  try {
    const store = createOffDutyStateStore();
    store.markCompletionNoticeSent("2026-03-25::易凡::off_duty_closed_notice", {
      status: "sent",
      staffName: "易凡"
    });

    assert.equal(
      store.hasCompletionNotice("2026-03-25::易凡::off_duty_closed_notice"),
      true
    );
    assert.equal(
      store.getCompletionNotice("2026-03-25::易凡::off_duty_closed_notice").status,
      "sent"
    );
  } finally {
    appConfig.offDutyStatePath = originalStatePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
