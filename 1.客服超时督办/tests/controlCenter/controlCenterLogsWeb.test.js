const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogPageHarness } = require("./controlCenterWebAppHelpers");

test("实时日志页应该把最新内容显示在最上面", () => {
  const { context, elements } = createLogPageHarness();

  context.renderLogs(
    {
      timeout: ["[08:25] 最早日志", "[08:26] 中间日志", "[08:27] 最新日志"],
      missed_reply: [],
      online_presence: [],
      off_duty: []
    },
    []
  );

  assert.equal(elements.logOutput.textContent, "[08:27] 最新日志\n[08:26] 中间日志\n[08:25] 最早日志");
});

test("实时日志页收到增量日志后应该继续保持顶部最新", () => {
  const { context, elements } = createLogPageHarness();

  context.renderLogs(
    {
      timeout: ["日志-1", "日志-2"],
      missed_reply: [],
      online_presence: [],
      off_duty: []
    },
    []
  );

  context.appendRealtimeLog({
    line: "日志-3",
    channels: ["timeout"]
  });

  assert.equal(elements.logOutput.textContent, "日志-3\n日志-2\n日志-1");
});
