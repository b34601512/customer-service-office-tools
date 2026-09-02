const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appConfig = require("../../src/config/appConfig");
const {
  createOnlinePresenceStateStore
} = require("../../src/features/onlinePresenceMonitor/onlinePresenceStateStore");

test("无人在线状态应该只对新一段无人在线发送提醒", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "online-presence-state-store-"));
  const originalStatePath = appConfig.onlinePresenceStatePath;
  appConfig.onlinePresenceStatePath = path.join(tempRoot, "state.json");

  try {
    const store = createOnlinePresenceStateStore();
    assert.equal(store.shouldSendAbsenceReminder("key-1"), true);

    store.markAbsenceReminderSent("key-1", {
      expectedStaffNames: ["郑兰"]
    });
    assert.equal(store.shouldSendAbsenceReminder("key-1"), false);
    assert.equal(store.shouldSendAbsenceReminder("key-2"), true);

    store.markPresenceRestored({
      onlineStaffNames: ["郑兰"]
    });
    assert.equal(store.shouldSendAbsenceReminder("key-1"), true);
  } finally {
    appConfig.onlinePresenceStatePath = originalStatePath;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
