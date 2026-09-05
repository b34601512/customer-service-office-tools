// 在独立解压目录中验证实际 TUI 初始化与六页渲染；只使用包内模块。
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const applicationRoot = path.resolve(process.argv[2]);
const result = spawnSync(process.execPath, ["-e", `
  const assert = require("node:assert/strict");
  const path = require("node:path");
  const { EventEmitter } = require("node:events");
  process.env.CUSTOMER_PERFORMANCE_SUPPRESS_CONSOLE_LOG = "1";
  const root = process.cwd();
  const { startTuiRuntime } = require(path.join(root, "src/cli/tui/startTuiRuntime.js"));
  const output = new EventEmitter();
  output.columns = 120;
  output.rows = 35;
  output.write = () => {};
  (async () => {
    const app = await startTuiRuntime({ output, scheduleStartupCleanup() {} });
    assert.equal(app.pages.length, 6);
    for (let index = 0; index < app.pages.length; index++) {
      app.switchPage(index);
      assert.ok(app.buildFrame().join("\\n").includes(app.pages[index].title));
    }
    app.stop();
    for (const name of Object.keys(require(path.join(root, "package.json")).dependencies)) {
      require(require.resolve(name, { paths: [root] }));
    }
    for (const filename of Object.keys(require.cache)) {
      assert.ok(filename.startsWith(path.dirname(root) + path.sep), "加载了包外模块：" + filename);
    }
    console.log("PASS: 独立目录首次启动、六页渲染和运行依赖加载");
    process.exit(0);
  })().catch(error => { console.error(error); process.exit(1); });
`], {
  cwd: applicationRoot,
  env: { ...process.env, NODE_PATH: "", NODE_OPTIONS: "" },
  encoding: "utf8",
  timeout: 30000,
  windowsHide: true
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
assert.ifError(result.error);
assert.equal(result.status, 0, "便携包无法独立启动");
