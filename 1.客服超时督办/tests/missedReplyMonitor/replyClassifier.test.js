const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyAgentReply,
  isCustomerClosingMessage,
  isCustomerResolutionMessage
} = require("../../src/features/missedReplyMonitor/replyClassifier");

const replyConfig = {
  missedReplyTemporaryReplyKeywords: [
    "稍等",
    "请稍等",
    "我查一下",
    { text: "我帮您跟领导反馈一下看看吧", matchMode: "exact" },
    "1"
  ],
  missedReplyCustomerResolutionKeywords: [
    { text: "找到问题了", matchMode: "includes" }
  ],
  missedReplyCustomerClosingKeywords: ["谢谢", "好的", "嗯", "嗯嗯", "嗯呢"],
  missedReplyInvalidAgentReplyKeywords: [".", "。", "，", ",", "、", "...", "…"]
};

test("客服发稍等类话术应该只算临时回复", () => {
  const result = classifyAgentReply({ text: "请稍等一下。" }, replyConfig);

  assert.equal(result.kind, "temporary");
});

test("单字临时关键词应该精确命中，避免误伤正常回复", () => {
  const result = classifyAgentReply({ text: "1号订单已经查到" }, replyConfig);

  assert.equal(result.kind, "substantive");
});

test("临时关键词配置完全匹配时不应该命中扩展句", () => {
  const result = classifyAgentReply(
    { text: "稍等一下" },
    {
      ...replyConfig,
      missedReplyTemporaryReplyKeywords: [{ text: "稍等", matchMode: "exact" }]
    }
  );

  assert.equal(result.kind, "substantive");
});

test("临时关键词配置包含匹配时应该命中句子中间", () => {
  const result = classifyAgentReply(
    { text: "麻烦稍等一下" },
    {
      ...replyConfig,
      missedReplyTemporaryReplyKeywords: [{ text: "稍等", matchMode: "includes" }]
    }
  );

  assert.equal(result.kind, "temporary");
});

test("旧字符串临时关键词默认按开头匹配", () => {
  const result = classifyAgentReply(
    { text: "请稍等一下。" },
    {
      ...replyConfig,
      missedReplyTemporaryReplyKeywords: ["请稍等"]
    }
  );

  assert.equal(result.kind, "temporary");
});

test("客服只发标点不应该算实质回复", () => {
  const result = classifyAgentReply({ text: "。" }, replyConfig);

  assert.equal(result.kind, "invalid");
});

test("客服发嗯嗯应该算明确实质回复", () => {
  const result = classifyAgentReply({ text: "嗯嗯" }, replyConfig);

  assert.equal(result.kind, "substantive");
});

test("客服发图片文件语音链接应该算实质回复", () => {
  const result = classifyAgentReply({ text: "", hasAttachment: true }, replyConfig);

  assert.equal(result.kind, "substantive");
});

test("客户弱收尾应该不单独触发漏回复", () => {
  assert.equal(isCustomerClosingMessage({ text: "嗯呢。" }, replyConfig), true);
});

test("客户明确表示找到问题时应该识别为主动结案", () => {
  assert.equal(isCustomerResolutionMessage({ text: "嗯找到问题了" }, replyConfig), true);
  assert.equal(isCustomerResolutionMessage({ text: "还没找到问题" }, replyConfig), false);
});

test("客户多个弱收尾词连在一起也不应该触发漏回复", () => {
  assert.equal(isCustomerClosingMessage({ text: "好的谢谢" }, replyConfig), true);
  assert.equal(isCustomerClosingMessage({ text: "好的，谢谢。" }, replyConfig), true);
  assert.equal(isCustomerClosingMessage({ text: "谢谢帮我查一下" }, replyConfig), false);
});

// issue #620：表情组合（如 [OK][抱拳]）应整体按纯表情处理，不得建责或冒充实质回复。
test("客服发送表情组合应判为无效回复", () => {
  assert.equal(classifyAgentReply({ text: "[OK][抱拳]" }, replyConfig).kind, "invalid");
  assert.equal(classifyAgentReply({ text: "【抱拳】【握手】" }, replyConfig).kind, "invalid");
});

test("客服表情加真实正文应算实质回复", () => {
  assert.equal(
    classifyAgentReply({ text: "[玫瑰]您的订单已加急处理" }, replyConfig).kind,
    "substantive"
  );
});

test("单个表情仍应判为无效回复", () => {
  assert.equal(classifyAgentReply({ text: "[微笑]" }, replyConfig).kind, "invalid");
});
