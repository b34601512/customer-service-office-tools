const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPayload,
  validateWebhook,
  maskWebhook,
  sendOnce
} = require("../scripts/发群消息.js");

test("parseArgs：解析文本、@手机号与 --send", () => {
  const options = parseArgs(["--text", "你好", "--mention", "13800000000, 13900000000", "--send"]);
  assert.equal(options.text, "你好");
  assert.deepEqual(options.mention, ["13800000000", "13900000000"]);
  assert.equal(options.send, true);
  assert.equal(options.type, "text");
});

test("parseArgs：未知参数直接报错，不静默忽略", () => {
  assert.throws(() => parseArgs(["--text", "x", "--send-all"]), /未知参数/);
});

test("buildPayload：text 带 @手机号；markdown 不带 @", () => {
  const textPayload = buildPayload({ type: "text", mention: ["13800000000"] }, "内容");
  assert.deepEqual(textPayload, {
    msgtype: "text",
    text: { content: "内容", mentioned_mobile_list: ["13800000000"] }
  });

  const markdownPayload = buildPayload({ type: "markdown", mention: ["13800000000"] }, "# 标题");
  assert.deepEqual(markdownPayload, { msgtype: "markdown", markdown: { content: "# 标题" } });
});

test("buildPayload：空内容拒绝发送", () => {
  assert.throws(() => buildPayload({ type: "text", mention: [] }, "   "), /内容为空/);
});

test("validateWebhook：只允许企微官方域名与路径", () => {
  assert.doesNotThrow(() =>
    validateWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abc")
  );
  assert.throws(() => validateWebhook("https://evil.example.com/cgi-bin/webhook/send?key=abc"), /已拒绝/);
  assert.throws(() => validateWebhook("https://qyapi.weixin.qq.com/other?key=abc"), /已拒绝/);
  assert.throws(() => validateWebhook("not-a-url"), /合法 URL/);
});

test("maskWebhook：不泄露 key", () => {
  const masked = maskWebhook("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret123");
  assert.ok(!masked.includes("secret123"));
  assert.ok(masked.includes("******"));
});

test("sendOnce：errcode 非 0 抛错，且只请求 1 次（不自动重试）", async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ errcode: 45009, errmsg: "api freq out of limit" })
    };
  };
  try {
    await assert.rejects(
      () => sendOnce("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=x", { msgtype: "text" }),
      /45009/
    );
    assert.equal(calls, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
