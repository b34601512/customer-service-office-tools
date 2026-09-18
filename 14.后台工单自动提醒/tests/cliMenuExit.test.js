// 菜单回归：管道环境（非 TTY）走输入式菜单，选 5(状态) 后选 0(退出) 必须干净退出。
// 这条锁的是"退出被常驻窗口的 CDP 连接挂住不退出"那个坑（用真控制台 + SendKeys 实测发现）。
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

test("输入式菜单：选状态再退出，程序必须自己结束（不残留进程）", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wo14-menu-"));
  const child = spawn(process.execPath, ["src/cli/startCli.js", "menu"], {
    cwd: ROOT,
    env: { ...process.env, WORK_ORDER_HOME: home },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let 输出 = "";
  child.stdout.on("data", (chunk) => {
    输出 += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    输出 += chunk.toString("utf8");
  });

  child.stdin.write("5\n"); // 状态（只读本地）
  setTimeout(() => child.stdin.write("0\n"), 1500); // 退出

  const 结果 = await new Promise((resolve) => {
    const 超时 = setTimeout(() => resolve({ code: "TIMEOUT" }), 15000);
    child.on("exit", (code) => {
      clearTimeout(超时);
      resolve({ code });
    });
  });

  assert.notStrictEqual(结果.code, "TIMEOUT", `选 0 之后必须退出，现在是卡住；已输出：\n${输出.slice(-400)}`);
  assert.strictEqual(结果.code, 0, `退出码应为 0，实际 ${结果.code}`);
});
