const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const appConfig = require("../../src/config/appConfig");
const { subscribeLogs } = require("../../src/engine/logHub");

const {
  extractAccessTokenFromStoredUser,
  extractContacts,
  extractMessages,
  extractMembers,
  fetchTransferMessages,
  fetchTransferMonitorSnapshot,
  normalizeContactsPageSize,
  resolveTargetRouteMeta
} = require("../../src/features/transferMonitor/transferApiClient");

const ORIGINAL_TARGET_URL = appConfig.targetUrl;
const TEST_TARGET_URL =
  "https://zan-mh.xiaoshunai.com/main/6925159c6cb1d36684d91499/6925159c6cb1d36684d91568/chat";

before(() => {
  appConfig.targetUrl = TEST_TARGET_URL;
});

after(() => {
  appConfig.targetUrl = ORIGINAL_TARGET_URL;
});

test("登录信息里应该能解析出接口鉴权 token", () => {
  const token = extractAccessTokenFromStoredUser(
    JSON.stringify({
      token: "token_123"
    })
  );

  assert.equal(token, "token_123");
});

test("联系人接口解析应该兼容 data.data 结构", () => {
  const payload = {
    data: {
      data: [
        {
          id: "chat_0",
          name: "旧客户"
        }
      ]
    }
  };

  assert.deepEqual(extractContacts(payload), payload.data.data);
});

test("联系人接口解析应该兼容 data.items 结构", () => {
  const payload = {
    data: {
      items: [
        {
          id: "chat_1",
          name: "罗马假日"
        }
      ]
    }
  };

  assert.deepEqual(extractContacts(payload), payload.data.items);
});

test("成员接口解析应该兼容 data.members 结构", () => {
  const payload = {
    data: {
      members: [
        {
          userId: "user_members",
          name: "王小明（售后客服）"
        }
      ]
    }
  };

  assert.deepEqual(extractMembers(payload), payload.data.members);
});

test("成员接口解析应该兼容 data 数组结构", () => {
  const payload = {
    data: [
      {
        userId: "user_1",
        name: "苏哲（售后组长）"
      }
    ]
  };

  assert.deepEqual(extractMembers(payload), payload.data);
});

test("消息接口解析应该兼容 data 数组结构", () => {
  const payload = {
    data: [
      {
        id: "msg_1",
        timestamp: 1776651459036
      }
    ]
  };

  assert.deepEqual(extractMessages(payload), payload.data);
});

test("目标网址解析应该能拆出 orgId 和 groupId", () => {
  const meta = resolveTargetRouteMeta();

  assert.equal(meta.orgId, "6925159c6cb1d36684d91499");
  assert.equal(meta.groupId, "6925159c6cb1d36684d91568");
  assert.equal(meta.origin, "https://zan-mh.xiaoshunai.com");
});

test("联系人接口页大小应该限制在安全范围内", () => {
  assert.equal(normalizeContactsPageSize(20), 20);
  assert.equal(normalizeContactsPageSize(0), 100);
  assert.equal(normalizeContactsPageSize(500), 100);
});

test("拉取转接监控快照时应该把 accessToken 带进每个接口请求", async () => {
  const seenInputs = [];
  const page = {
    async evaluate(pageFunction, input) {
      if (input === undefined) {
        return JSON.stringify({ token: "token_abc" });
      }

      seenInputs.push(input);
      if (String(input.requestPath || "").includes("/api/chat/contacts")) {
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            code: 0,
            data: [
              {
                id: "chat_1",
                name: "罗马假日",
                assignedTo: "user_1",
                lastAssignedTimestamp: 1776309733305,
                lastMessage: "您好"
              }
            ]
          })
        };
      }

      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: [
            {
              userId: "user_1",
              name: "顾远（售前客服）"
            }
          ]
        })
      };
    }
  };

  const snapshot = await fetchTransferMonitorSnapshot(page);

  assert.equal(seenInputs.length, 2);
  assert.equal(seenInputs[0].accessToken, "token_abc");
  assert.match(seenInputs[0].requestPath, /pageSize=100/);
  assert.equal(seenInputs[1].accessToken, "token_abc");
  assert.equal(snapshot.contacts.length, 1);
  assert.equal(snapshot.contacts[0].customerName, "罗马假日");
  assert.equal(snapshot.memberMapByUserId.user_1.staffName, "顾远");
});

test("拉取联系人快照时应该允许调用方指定最近客户范围", async () => {
  const seenInputs = [];
  const page = {
    async evaluate(pageFunction, input) {
      if (input === undefined) {
        return JSON.stringify({ token: "token_abc" });
      }

      seenInputs.push(input);
      if (String(input.requestPath || "").includes("/api/chat/contacts")) {
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            code: 0,
            data: [
              {
                id: "chat_1",
                name: "最近客户",
                assignedTo: "user_1",
                lastMessage: "您好"
              }
            ]
          })
        };
      }

      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: [
            {
              userId: "user_1",
              name: "顾远（售前客服）"
            }
          ]
        })
      };
    }
  };

  await fetchTransferMonitorSnapshot(page, { contactPageSize: 20 });

  assert.match(seenInputs[0].requestPath, /pageSize=20/);
});

test("分配快照日志应该只在摘要变化时记录", async () => {
  const capturedLines = [];
  let assignedTo = "user_1";
  const page = {
    async evaluate(pageFunction, input) {
      if (input === undefined) {
        return JSON.stringify({ token: "token_abc" });
      }

      if (String(input.requestPath || "").includes("/api/chat/contacts")) {
        return {
          ok: true,
          status: 200,
          text: JSON.stringify({
            code: 0,
            data: [
              {
                id: "chat_1",
                name: "最近客户",
                assignedTo,
                lastMessage: "您好"
              }
            ]
          })
        };
      }

      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: [
            {
              userId: "user_1",
              name: "顾远（售前客服）"
            }
          ]
        })
      };
    }
  };
  const unsubscribe = subscribeLogs((line) => {
    if (line.includes("[读取分配快照]")) {
      capturedLines.push(line);
    }
  });

  try {
    await fetchTransferMonitorSnapshot(page);
    await fetchTransferMonitorSnapshot(page);
    assignedTo = "";
    await fetchTransferMonitorSnapshot(page);
  } finally {
    unsubscribe();
  }

  assert.equal(capturedLines.length, 2);
  assert.match(capturedLines[0], /已分配=1/);
  assert.match(capturedLines[1], /已分配=0/);
});

test("读取转接消息时应该把 accessToken 带进消息接口请求", async () => {
  const seenInputs = [];
  const page = {
    async evaluate(pageFunction, input) {
      if (input === undefined) {
        return JSON.stringify({ token: "token_msg" });
      }

      seenInputs.push(input);
      return {
        ok: true,
        status: 200,
        text: JSON.stringify({
          code: 0,
          data: [
            {
              id: "msg_1",
              timestamp: 1776651459036,
              content: {
                type: 10000
              }
            }
          ]
        })
      };
    }
  };

  const messages = await fetchTransferMessages(page, "chat_1");

  assert.equal(seenInputs.length, 1);
  assert.equal(seenInputs[0].accessToken, "token_msg");
  assert.match(seenInputs[0].requestPath, /\/api\/chat\/messages/);
  assert.match(seenInputs[0].requestPath, /id=chat_1/);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].id, "msg_1");
});
