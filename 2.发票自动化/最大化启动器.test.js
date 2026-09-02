const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const 根目录 = __dirname;
const TUI启动器列表 = [
  "../1.客服超时督办/启动中心.bat",
  "启动发票自动化.bat",
  "1.京东开票巡检/启动巡检.bat",
  "2.京东发票回传/启动催票后台.bat",
  "3.通用发票下载中心/启动下载中心.bat",
  "4.天猫发票回传/启动天猫登录.bat",
  "5.拼多多发票回传/启动拼多多后台.bat",
  "6.抖音发票回传/启动抖音后台.bat",
  "../5.电话漏接分析/一键启动.bat",
  "../9.客服数据自动更新/启动控制台.bat",
  "../10.自动报量/运行自动报量CLI.bat",
  "../12.店铺指标数据自动更新/启动控制台.bat",
];

test("所有 TUI/CLI 批处理入口都使用统一的最大化重拉起方式", () => {
  for (const 相对路径 of TUI启动器列表) {
    const 源码 = fs.readFileSync(path.join(根目录, 相对路径), "utf8");
    assert.match(
      源码,
      /start "" \/max "%ComSpec%" \/d \/c call "%~f0" --launcher-maximized %\*/,
      `${相对路径} 缺少最大化重拉起命令`,
    );
    assert.match(
      源码,
      /if \/i "%~1"=="--launcher-maximized" shift/,
      `${相对路径} 缺少最大化启动标记消费逻辑`,
    );
  }
});

test("非批处理直接进入 TUI 时也会请求最大化当前窗口", () => {
  const 入口列表 = [
    ["../1.客服超时督办/src/controlCenter/startControlCenter.js", /最大化当前控制台窗口\(\)/],
    ["../9.客服数据自动更新/src/cli/tui/startTuiRuntime.js", /最大化当前控制台窗口\(\)/],
  ];
  for (const [相对路径, 模式] of 入口列表) {
    const 源码 = fs.readFileSync(path.join(根目录, 相对路径), "utf8");
    assert.match(源码, 模式, `${相对路径} 缺少直接启动时的最大化调用`);
  }
});
