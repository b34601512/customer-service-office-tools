const test = require("node:test");
const assert = require("node:assert/strict");
const { progressBar } = require("../src/cli/tui/gameUi");
const { displayWidth, stripAnsi } = require("../src/cli/tui/width");

test("进度条使用9号项目风格并保持固定宽度", () => {
  const runningBar = stripAnsi(progressBar(1, 2, 20, "brightYellow"));
  const completedBar = stripAnsi(progressBar(2, 2, 20, "brightGreen"));

  assert.match(runningBar, /▰/);
  assert.match(runningBar, /▱/);
  assert.match(runningBar, /50%/);
  assert.doesNotMatch(runningBar, /█|░/);
  assert.equal(displayWidth(runningBar), 20);
  assert.match(completedBar, /100%/);
  assert.equal(displayWidth(completedBar), 20);
});
