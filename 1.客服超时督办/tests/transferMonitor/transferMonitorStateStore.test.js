const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");

const appConfig = require("../../src/config/appConfig");
const {
  buildEmptyTransferMonitorState,
  readTransferMonitorState,
  writeTransferMonitorState
} = require("../../src/features/transferMonitor/transferMonitorStateStore");

const ORIGINAL_STATE_PATH = appConfig.transferMonitorStatePath;

function createTempStateContext(t) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "transfer-monitor-state-"));
  appConfig.transferMonitorStatePath = path.join(rootDir, "state.json");
  t.after(() => {
    appConfig.transferMonitorStatePath = ORIGINAL_STATE_PATH;
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
}

test("没有状态文件时应该返回空白状态", (t) => {
  createTempStateContext(t);

  assert.deepEqual(readTransferMonitorState(), buildEmptyTransferMonitorState());
});

test("写入状态后应该能重新读回联系人基线", (t) => {
  createTempStateContext(t);
  const state = {
    contactsByChatId: {
      chat_1: {
        chatId: "chat_1",
        customerName: "罗马假日",
        assignedToUserId: "user_a",
        lastAssignedTimestamp: 1776309733305
      }
    }
  };

  writeTransferMonitorState(state);
  const reloaded = readTransferMonitorState();

  assert.deepEqual(reloaded.contactsByChatId, state.contactsByChatId);
  assert.equal(typeof reloaded.updatedAt, "string");
});
