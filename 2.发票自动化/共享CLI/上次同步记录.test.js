const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  格式化本地时间,
  提取读取单数,
  写入上次同步记录,
  读取上次同步记录,
  构建上次同步文本,
} = require("./上次同步记录");

test("提取读取单数：单店直接取数，多店累加，没有该措辞时返回 null", () => {
  assert.equal(提取读取单数("抖音「A店」只读同步完成：读取 0 单，新增 0 单。"), 0);
  assert.equal(提取读取单数("读取 2 单（新增 1）｜读取 3 单（新增 0）"), 5);
  assert.equal(提取读取单数("本轮结束：2 家店，失败店铺 0 家；订单成功 1、跳过 0、失败 0。"), null);
  assert.equal(提取读取单数(""), null);
});

test("格式化本地时间：无效输入返回空串", () => {
  assert.equal(格式化本地时间(""), "");
  assert.equal(格式化本地时间("不是时间"), "");
  assert.equal(格式化本地时间(new Date(2026, 8, 14, 9, 5)), "2026-09-14 09:05");
});

test("上次同步记录：写入后可读回，展示文本带本地时间与读取单数", () => {
  const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "上次同步记录-"));
  const 文件路径 = path.join(临时目录, "state", "last-sync.json");
  try {
    写入上次同步记录(文件路径, {
      at: new Date(2026, 8, 14, 11, 30, 5).toISOString(),
      任务: "同步",
      状态: "done",
      消息: "天猫「A店」只读同步完成：读取 2 单，新增 1 单。",
    });
    const 记录 = 读取上次同步记录(文件路径);
    assert.equal(记录.读取单数, 2);
    assert.equal(记录.状态, "done");
    assert.equal(构建上次同步文本(记录), "上次同步：2026-09-14 11:30（读取 2 单）");
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test("上次同步记录：无记录时展示空文本；任务没有读取单数时退回完成/失败", () => {
  assert.equal(构建上次同步文本(null), "");
  assert.equal(构建上次同步文本(读取上次同步记录(path.join(os.tmpdir(), "不存在的上次同步记录.json"))), "");
  assert.equal(
    构建上次同步文本({ at: new Date(2026, 8, 14, 11, 30).toISOString(), 状态: "done", 消息: "本轮结束：1 家店" }),
    "上次同步：2026-09-14 11:30（完成）",
  );
  assert.equal(
    构建上次同步文本({ at: new Date(2026, 8, 14, 11, 30).toISOString(), 状态: "error", 消息: "任务失败：登录超时" }),
    "上次同步：2026-09-14 11:30（失败）",
  );
});
