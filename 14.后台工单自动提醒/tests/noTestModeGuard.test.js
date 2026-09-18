// 反向断言（2026-09-18 用户拍板）：这是真项目，不要再有"演练 / 测试模式 / 测试提醒"这类入口。
// 曾经存在的 dry-run（once --dry-run、run --dry-run、菜单 [8] 演练常驻、test-notify 测试提醒）已彻底删除；
// 本测试把"不许再加回来"锁死：谁再往 src 里塞这些，测试立刻红。
// 允许例外：本测试自己、以及 logger 的终端静音开关（那是界面层，不是演练）。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "..", "src");
const 禁止词 = [/dry-?run/i, /演练/, /test-notify/i, /测试模式/, /测试提醒/];

function 收集Js文件(目录) {
  const 结果 = [];
  for (const 项 of fs.readdirSync(目录, { withFileTypes: true })) {
    const 完整 = path.join(目录, 项.name);
    if (项.isDirectory()) 结果.push(...收集Js文件(完整));
    else if (项.name.endsWith(".js")) 结果.push(完整);
  }
  return 结果;
}

test("src 里不许再出现演练/测试模式入口（dry-run、演练、test-notify、测试提醒）", () => {
  const 命中 = [];
  for (const 文件 of 收集Js文件(SRC)) {
    const 文本 = fs.readFileSync(文件, "utf8");
    for (const 词 of 禁止词) {
      if (词.test(文本)) {
        命中.push(`${path.relative(SRC, 文件)} ← ${词}`);
      }
    }
  }
  assert.deepStrictEqual(命中, [], `这些位置又出现了演练/测试入口，应当删掉：\n${命中.join("\n")}`);
});

test("菜单第一项必须是「启动常驻监控」，且不存在演练项", () => {
  const 文本 = fs.readFileSync(path.join(SRC, "cli", "startCli.js"), "utf8");
  const 菜单区 = 文本.slice(文本.indexOf("const 菜单项 = ["), 文本.indexOf("];", 文本.indexOf("const 菜单项 = [")));
  const 第一项 = 菜单区.split("\n").find((行) => 行.includes("action:"));
  assert.ok(第一项.includes("启动常驻监控"), `菜单第一项应当是启动常驻监控，实际：${第一项}`);
  assert.ok(菜单区.includes('action: "run"'), "第一项要接常驻监控");
  assert.ok(!菜单区.includes("演练"), "菜单里不许有演练项");
});

test("CLI 帮助里不再出现 dry-run / test-notify", () => {
  const 文本 = fs.readFileSync(path.join(SRC, "cli", "startCli.js"), "utf8");
  const 帮助区 = 文本.slice(文本.indexOf("命令用法"), 文本.indexOf("不带参数"));
  assert.ok(!/dry-?run/i.test(帮助区), "帮助里不许再列 --dry-run");
  assert.ok(!/test-notify/i.test(帮助区), "帮助里不许再列 test-notify");
  assert.ok(/run\s+启动常驻监控/.test(帮助区), "帮助里要保留启动常驻监控");
});
