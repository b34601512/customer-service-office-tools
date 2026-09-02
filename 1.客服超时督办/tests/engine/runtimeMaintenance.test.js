const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appConfig = require("../../src/config/appConfig");
const { compactLogFileIfNeeded } = require("../../src/engine/runtimeMaintenance/logFileCompactor");
const {
  compactRuntimeStateFiles,
  compactTransferState
} = require("../../src/engine/runtimeMaintenance/stateCompactor");

const ORIGINAL_PATHS = {
  missedReplyMonitorStatePath: appConfig.missedReplyMonitorStatePath,
  transferMonitorStatePath: appConfig.transferMonitorStatePath,
  onlinePresenceStatePath: appConfig.onlinePresenceStatePath,
  offDutyStatePath: appConfig.offDutyStatePath
};

function writeJson(filePath, value) {
  // 该函数写入测试状态文件，让每个测试都能独立构造膨胀现场。
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  // 该函数读取裁剪后的测试状态，避免断言直接依赖内存对象。
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function useTempRuntimeStatePaths(t) {
  // 该函数把运行状态路径切到临时目录，避免测试碰到真实生产 runtime。
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-maintenance-"));
  appConfig.missedReplyMonitorStatePath = path.join(tempRoot, "missed-reply", "state.json");
  appConfig.transferMonitorStatePath = path.join(tempRoot, "transfer", "state.json");
  appConfig.onlinePresenceStatePath = path.join(tempRoot, "online", "state.json");
  appConfig.offDutyStatePath = path.join(tempRoot, "off-duty", "state.json");
  t.after(() => {
    appConfig.missedReplyMonitorStatePath = ORIGINAL_PATHS.missedReplyMonitorStatePath;
    appConfig.transferMonitorStatePath = ORIGINAL_PATHS.transferMonitorStatePath;
    appConfig.onlinePresenceStatePath = ORIGINAL_PATHS.onlinePresenceStatePath;
    appConfig.offDutyStatePath = ORIGINAL_PATHS.offDutyStatePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  return tempRoot;
}

test("当前日志超过上限时应该自动裁剪并保留最新现场", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-log-compactor-"));
  const logFilePath = path.join(tempRoot, "current-run.log");
  t.after(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(
    logFilePath,
    `${Array.from({ length: 40 }, (_, index) => `第${index + 1}行-${"x".repeat(20)}`).join("\n")}\n`,
    "utf8"
  );

  const result = compactLogFileIfNeeded(logFilePath, {
    maxBytes: 300,
    keepBytes: 180
  });
  const compactedText = fs.readFileSync(logFilePath, "utf8");

  assert.equal(result.changed, true);
  assert.match(compactedText, /运行膨胀治理/);
  assert.doesNotMatch(compactedText, /第1行/);
  assert.match(compactedText, /第40行/);
});

test("运行状态治理应该裁剪过期条目并保留当前无人在线段", (t) => {
  useTempRuntimeStatePaths(t);
  const nowMs = Date.parse("2026-06-30T00:00:00+08:00");
  const oldMs = nowMs - 40 * 24 * 60 * 60 * 1000;
  const recentMs = nowMs - 2 * 24 * 60 * 60 * 1000;

  writeJson(appConfig.missedReplyMonitorStatePath, {
    reminderEventsByChatId: {
      old_chat: { lastReminderAtMs: oldMs },
      recent_chat: { lastReminderAtMs: recentMs }
    },
    reminderSnapshotsByChatId: {
      old_chat: { reminderSentAtMs: oldMs },
      recent_chat: { reminderSentAtMs: recentMs }
    },
    countdownItemsByChatId: {
      old_chat: { scannedAtMs: oldMs },
      recent_chat: { scannedAtMs: recentMs }
    },
    decisionItemsByChatId: {
      old_chat: { scannedAtMs: oldMs },
      recent_chat: { scannedAtMs: recentMs }
    }
  });
  writeJson(appConfig.transferMonitorStatePath, {
    contactsByChatId: {
      old_chat: { lastAssignedTimestamp: oldMs },
      recent_chat: { lastAssignedTimestamp: recentMs }
    }
  });
  writeJson(appConfig.onlinePresenceStatePath, {
    activeAbsenceKey: "old_absence",
    remindersByAbsenceKey: {
      old_absence: { sentAtMs: oldMs },
      old_closed_absence: { sentAtMs: oldMs },
      recent_absence: { sentAtMs: recentMs }
    }
  });
  writeJson(appConfig.offDutyStatePath, {
    completedActions: {
      old_action: { completedAt: new Date(oldMs).toISOString() },
      recent_action: { completedAt: new Date(recentMs).toISOString() }
    },
    completionNotices: {
      old_notice: { sentAtMs: oldMs },
      recent_notice: { sentAtMs: recentMs }
    }
  });

  const result = compactRuntimeStateFiles({
    retentionDays: 35,
    maxEntries: 20,
    nowMs
  });

  assert.equal(result.removedCount, 8);
  assert.deepEqual(Object.keys(readJson(appConfig.missedReplyMonitorStatePath).reminderEventsByChatId), ["recent_chat"]);
  assert.deepEqual(Object.keys(readJson(appConfig.transferMonitorStatePath).contactsByChatId), ["recent_chat"]);
  assert.deepEqual(
    Object.keys(readJson(appConfig.onlinePresenceStatePath).remindersByAbsenceKey).sort(),
    ["old_absence", "recent_absence"]
  );
  assert.deepEqual(Object.keys(readJson(appConfig.offDutyStatePath).completedActions), ["recent_action"]);
});

test("状态对象池超过数量上限时应该优先保留最新条目", () => {
  const result = compactTransferState(
    {
      contactsByChatId: {
        oldest: { lastAssignedTimestamp: 10 },
        newest: { lastAssignedTimestamp: 30 },
        middle: { lastAssignedTimestamp: 20 }
      }
    },
    {
      retentionDays: 3650,
      maxEntries: 2,
      nowMs: 40
    }
  );

  assert.equal(result.removedCount, 1);
  assert.deepEqual(Object.keys(result.state.contactsByChatId), ["newest", "middle"]);
});
