const test = require("node:test");
const assert = require("node:assert/strict");
const { createTasksPage } = require("../src/cli/tui/pages/tasks");
const { stripAnsi, displayWidth } = require("../src/cli/tui/width");

test("汇总页标题框和进度条使用紧凑宽度", () => {
  const page = createTasksPage();
  const app = {
    columns: 100,
    contentHeight: 20,
    ctx: {
      services: {
        getState: () => ({
          status: "running",
          startedAt: new Date().toISOString(),
          storeResults: [{
            status: "running",
            storeName: "京东1店",
            detail: "读取页面指标"
          }]
        })
      }
    }
  };

  const lines = page.render(app).map(stripAnsi);
  assert.equal(displayWidth(lines[0]), 34);

  const progressLine = lines.find((line) => line.startsWith(" 进度  "));
  assert.ok(progressLine);
  assert.equal(displayWidth(progressLine.slice(" 进度  ".length)), 40);
});
