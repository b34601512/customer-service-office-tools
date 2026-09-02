const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appConfig = require("../../src/config/appConfig");
const {
  createTransferMonitorRuntimeState,
  mergeCurrentContactsIntoRuntimeState
} = require("../../src/features/transferMonitor/transferMonitorWorkflow");
const { writeTransferMonitorState } = require("../../src/features/transferMonitor/transferMonitorStateStore");

const ORIGINAL_STATE_PATH = appConfig.transferMonitorStatePath;

function createTempStateContext(t) {
  // 这里隔离状态文件，避免测试污染生产运行快照。
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-monitor-workflow-"));
  appConfig.transferMonitorStatePath = path.join(rootDir, "state.json");
  t.after(() => {
    appConfig.transferMonitorStatePath = ORIGINAL_STATE_PATH;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
}

test("转接监控启动时应该忽略上次运行基线，避免补发离线历史转接", (t) => {
  createTempStateContext(t);
  writeTransferMonitorState({
    contactsByChatId: {
      chat_1: {
        chatId: "chat_1",
        customerName: "罗马假日",
        assignedToUserId: "user_old",
        lastAssignedTimestamp: 1782350000000
      }
    }
  });

  const runtimeState = createTransferMonitorRuntimeState();

  assert.deepEqual(runtimeState.contactsByChatId, {});
  assert.equal(runtimeState.lastSummaryKey, "");
});

test("转接监控每轮只保留当前快照，避免历史客户基线无限膨胀", () => {
  const runtimeState = {
    contactsByChatId: {
      old_chat: {
        chatId: "old_chat",
        customerName: "旧客户",
        assignedToUserId: "user_old",
        lastAssignedTimestamp: 1773972000000
      }
    }
  };

  mergeCurrentContactsIntoRuntimeState(runtimeState, [
    {
      chatId: "chat_1",
      customerName: "罗马假日",
      assignedToUserId: "user_new",
      lastAssignedTimestamp: 1774058400000
    }
  ]);

  assert.deepEqual(Object.keys(runtimeState.contactsByChatId), ["chat_1"]);
  assert.equal(runtimeState.contactsByChatId.chat_1.customerName, "罗马假日");
});
