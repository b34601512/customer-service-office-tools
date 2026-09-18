const test = require("node:test");
const assert = require("node:assert/strict");
const { formatOnceResult } = require("../src/cli/formatOnceResult");

// 背景（2026-09-18 实跑）：CLI 过去打印 `item.content`，而 service 推入的字段是 `messages`（数组），
// dry-run 预览全是 `undefined` —— 用户"先看文案再决定发不发"的能力被这行字毁了。本测试锁死正确字段。
test("dry-run 预览必须打印真实文案（messages 数组），不允许出现 undefined", () => {
  const lines = formatOnceResult({
    sent: [
      {
        event: { sourceId: "jd/jd1/workorder", type: "login_required" },
        messages: ["【工单提醒】京东1店 后台工单\n店铺登录态已失效，请尽快重新登录京麦。"],
        ok: true,
        dryRun: true
      }
    ]
  });
  const 全文 = lines.join("\n");
  assert.match(全文, /演练/, "要标出这是演练");
  assert.match(全文, /店铺登录态已失效/, "必须打印真实文案正文");
  assert.doesNotMatch(全文, /undefined/, "不允许再打印 undefined（字段名写错就会这样）");
});

test("一单一消息：多条消息要逐条打印", () => {
  const lines = formatOnceResult({
    sent: [{ event: { sourceId: "jd/jd3/workorder", type: "count_increase" }, messages: ["单1文案", "单2文案"], ok: true, dryRun: true }]
  });
  assert.ok(lines.includes("单1文案") && lines.includes("单2文案"), "每条消息都要出现");
});

test("发送失败要显示原因；没有变化要明说（不许静默）", () => {
  const 失败 = formatOnceResult({ sent: [{ event: { sourceId: "jd/jd6/dispute", type: "count_increase" }, messages: ["x"], ok: false, error: "企微超时" }] }).join("\n");
  assert.match(失败, /发送失败：企微超时/);
  assert.match(formatOnceResult({ sent: [] }).join("\n"), /本轮没有需要提醒的变化/);
  // 事件没有文案时必须显式提示，不能什么都不打
  assert.match(formatOnceResult({ sent: [{ event: { sourceId: "a/b/c", type: "t" }, messages: [], ok: true, dryRun: true }] }).join("\n"), /没有生成文案/);
});
