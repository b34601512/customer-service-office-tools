const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createChatMonitorRuntimeState,
  resolveDueChatMonitorTasks,
  resolveSharedSnapshotPageSize
} = require("../../src/features/chatMonitorRuntime/workflowRunner");
const { TRANSFER_MONITOR_CONTACTS_PAGE_SIZE } = require("../../src/features/transferMonitor/transferApiClient");
const {
  selectContactsFromSharedSnapshot
} = require("../../src/features/missedReplyMonitor/missedReplyWorkflow/scanRunner");

test("聊天监控应该用一份快照同时满足转接和未回复", () => {
  const runtimeState = createChatMonitorRuntimeState(1000);
  const replyConfig = {
    missedReplyMonitorEnabled: true
  };
  const dueTasks = resolveDueChatMonitorTasks(runtimeState, replyConfig, 1000);

  assert.deepEqual(dueTasks, {
    transferDue: true,
    missedReplyDue: true
  });
  assert.equal(resolveSharedSnapshotPageSize(replyConfig, dueTasks), TRANSFER_MONITOR_CONTACTS_PAGE_SIZE);
});

test("未回复独自到期时也应该读取完整联系人快照", () => {
  const replyConfig = {
    missedReplyMonitorEnabled: true
  };
  const dueTasks = {
    transferDue: false,
    missedReplyDue: true
  };

  assert.equal(resolveSharedSnapshotPageSize(replyConfig, dueTasks), TRANSFER_MONITOR_CONTACTS_PAGE_SIZE);
});

test("未回复扫描不应该再截断为最近20位联系人", () => {
  const contacts = Array.from({ length: 90 }, (_, index) => ({
    chatId: `chat_${index + 1}`
  }));

  assert.equal(selectContactsFromSharedSnapshot({ contacts }).length, 90);
});
