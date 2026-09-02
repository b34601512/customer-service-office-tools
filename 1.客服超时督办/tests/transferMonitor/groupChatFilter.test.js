const { test } = require("node:test");
const assert = require("node:assert/strict");
const appConfig = require("../../src/config/appConfig");
const {
  filterGroupChatContacts,
  isGroupChatContact,
  isOfficialGroupChatContact,
  normalizeGroupChatFilterConfig
} = require("../../src/features/transferMonitor/groupChatFilter");
const { fetchTransferMonitorSnapshot } = require("../../src/features/transferMonitor/transferApiClient");

const ORIGINAL_TARGET_URL = appConfig.targetUrl;
const TEST_TARGET_URL =
  "https://zan-mh.xiaoshunai.com/main/6925159c6cb1d36684d91499/6925159c6cb1d36684d91568/chat";

test("官方字段识别群聊：type=1 应该命中", () => {
  assert.equal(isOfficialGroupChatContact({ type: 1, name: "线上分销-德达赋氧退货跟踪" }), true);
});

test("官方字段识别群聊：wxid 以 R: 开头应该命中", () => {
  assert.equal(isOfficialGroupChatContact({ wxid: "R:10850735860617177", name: "线上分销-德达赋氧退货跟踪" }), true);
});

test("官方字段识别群聊：带 memberCount 应该命中", () => {
  assert.equal(isOfficialGroupChatContact({ memberCount: 8, name: "发票沟通群" }), true);
  assert.equal(isOfficialGroupChatContact({ memberCount: 0 }), false);
});

test("官方字段识别群聊：type=0 且无群特征的客户单聊不应命中", () => {
  // 现场真实客户样例：type=0、wxid 无 R: 前缀、无 memberCount。
  assert.equal(
    isOfficialGroupChatContact({
      type: 0,
      name: "向阳而生【有意 以旧换新】",
      wxid: "7881303063929145",
      contactType: 1
    }),
    false
  );
  // 昵称带“群”字的真实客户：官方字段不识别，不应误伤。
  assert.equal(isOfficialGroupChatContact({ type: 0, name: "王群【客户】" }), false);
  assert.equal(isOfficialGroupChatContact({}), false);
  assert.equal(isOfficialGroupChatContact(undefined), false);
});

test("归一化后的群聊标记只依据 isGroupFlag", () => {
  assert.equal(isGroupChatContact({ isGroupFlag: true }), true);
  assert.equal(isGroupChatContact({ isGroupFlag: false }), false);
  assert.equal(isGroupChatContact({}), false);
  // 名称里的“群”字不再参与判定
  assert.equal(isGroupChatContact({ customerName: "退款对接群", isGroupFlag: false }), false);
});

test("过滤联系人列表时应该按官方标记拆出群聊与客户两份", () => {
  const config = normalizeGroupChatFilterConfig();
  const contacts = [
    { customerName: "线上分销-德达赋氧退货跟踪", isGroupFlag: true },
    { customerName: "发票沟通群", isGroupFlag: true },
    { customerName: "至简", isGroupFlag: false },
    { customerName: "王群【客户】", isGroupFlag: false }
  ];
  const result = filterGroupChatContacts(contacts, config);
  assert.deepEqual(
    result.contacts.map((item) => item.customerName),
    ["至简", "王群【客户】"]
  );
  assert.deepEqual(
    result.groupContacts.map((item) => item.customerName),
    ["线上分销-德达赋氧退货跟踪", "发票沟通群"]
  );
});

test("快照拉取时应该按官方字段自动剔除群聊会话", async () => {
  appConfig.targetUrl = TEST_TARGET_URL;
  try {
    const page = {
      async evaluate(pageFunction, input) {
        if (input === undefined) {
          return JSON.stringify({ token: "token_group" });
        }

        if (String(input.requestPath || "").includes("/api/chat/contacts")) {
          return {
            ok: true,
            status: 200,
            text: JSON.stringify({
              code: 0,
              data: [
                {
                  id: "chat_group_1",
                  name: "线上分销-德达赋氧退货跟踪",
                  type: 1,
                  wxid: "R:10850735860617177",
                  memberCount: 8,
                  lastMessage: "潺潺：【撤回】"
                },
                {
                  id: "chat_group_2",
                  name: "退款对接群",
                  type: 1,
                  wxid: "R:2263037932",
                  memberCount: 17
                },
                {
                  id: "chat_customer_1",
                  name: "至简",
                  type: 0,
                  wxid: "7881303063929145",
                  assignedTo: "user_1",
                  lastMessage: "在吗"
                },
                {
                  id: "chat_customer_2",
                  name: "王群【客户】",
                  type: 0,
                  wxid: "12345",
                  assignedTo: "user_2",
                  lastMessage: "稍等"
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
    assert.deepEqual(
      snapshot.contacts.map((item) => item.customerName),
      ["至简", "王群【客户】"]
    );
    assert.deepEqual(
      snapshot.groupContacts.map((item) => item.customerName),
      ["线上分销-德达赋氧退货跟踪", "退款对接群"]
    );
  } finally {
    appConfig.targetUrl = ORIGINAL_TARGET_URL;
  }
});

test("关闭群聊识别后应该保留全部联系人", () => {
  const config = normalizeGroupChatFilterConfig({ groupChatFilterEnabled: false });
  const contacts = [{ customerName: "退款对接群", isGroupFlag: true }, { customerName: "至简", isGroupFlag: false }];
  const result = filterGroupChatContacts(contacts, config);
  assert.equal(result.contacts.length, 2);
  assert.equal(result.groupContacts.length, 0);
});
