// 服务层集成测试：跑真实 monitorOnce 链路（真实状态文件、真实账本、真实判定），
// 只把「浏览器探测」与「企微网络发送」两个外部依赖注入为假实现；运行目录用 WORK_ORDER_HOME 隔离。
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "wo14-"));
process.env.WORK_ORDER_HOME = home;
const configPath = path.join(home, "platform-config.json");

const { monitorOnce, loadMonitorState } = require("../src/features/workOrderMonitor/service");
const { STATUS } = require("../src/features/workOrderMonitor/alertPolicy");

function makeConfig() {
  return {
    wecom: { webhookUrl: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fake", webhookName: "测试" },
    monitor: { intervalMinutes: 5, loginAlertThrottleMinutes: 60, repeatReminderMinutes: 0, alertOnFirstRun: true },
    platforms: {
      jd: {
        displayName: "京东",
        stores: [{
          key: "s1", displayName: "测试店", username: "u", mentionedMobileList: ["13800000000"],
          sources: [{ key: "wo", displayName: "后台工单", type: "jingxiWorkOrder", url: "https://example/wo", watch: ["平台协同工单"] }]
        }]
      }
    }
  };
}

function probe(counts, status = STATUS.OK) {
  return async () => ({ wo: { status, counts } });
}

test("真实链路：首轮非零计数→发送成功→落账本与基线", async () => {
  const sentMessages = [];
  const r = await monitorOnce({
    configOverride: makeConfig(),
    probeStoreImpl: probe({ "平台协同工单": 2 }),
    sendTextImpl: async (url, name, content, mentions) => { sentMessages.push({ content, mentions }); }
  });
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(r.sent[0].ok, true);
  assert.match(sentMessages[0].content, /新增 2 单/);
  assert.deepStrictEqual(sentMessages[0].mentions, ["13800000000"]);
  const ledger = fs.readFileSync(path.join(home, "state", "alert-ledger.jsonl"), "utf8").trim().split("\n");
  assert.strictEqual(ledger.length, 1);
  assert.strictEqual(loadMonitorState().sources["jd/s1/wo"].counts["平台协同工单"], 2);
});

test("真实链路：第二轮无变化→静默", async () => {
  const r = await monitorOnce({
    configOverride: makeConfig(),
    probeStoreImpl: probe({ "平台协同工单": 2 }),
    sendTextImpl: async () => { throw new Error("不该发送"); }
  });
  assert.strictEqual(r.events.length, 0);
  assert.strictEqual(r.sent.length, 0);
});

test("真实链路：发送失败→基线回滚，下一轮重新触发不丢提醒", async () => {
  const config = makeConfig();
  let calls = 0;
  const failOnce = {
    probeStoreImpl: probe({ "平台协同工单": 5 }),
    sendTextImpl: async () => { calls += 1; if (calls === 1) throw new Error("模拟网络失败"); }
  };
  const r1 = await monitorOnce({ configOverride: config, ...failOnce });
  assert.strictEqual(r1.sent[0].ok, false);
  assert.strictEqual(loadMonitorState().sources["jd/s1/wo"].counts["平台协同工单"], 2, "基线应回滚到上一成功值");
  const r2 = await monitorOnce({ configOverride: config, ...failOnce });
  assert.strictEqual(r2.sent[0].ok, true);
  assert.strictEqual(loadMonitorState().sources["jd/s1/wo"].counts["平台协同工单"], 5);
});

test("真实链路：dryRun 不发送也不改基线", async () => {
  const before = fs.readFileSync(path.join(home, "state", "monitor-state.json"), "utf8");
  const r = await monitorOnce({
    dryRun: true,
    configOverride: makeConfig(),
    probeStoreImpl: probe({ "平台协同工单": 9 }),
    sendTextImpl: async () => { throw new Error("演练不该发送"); }
  });
  assert.strictEqual(r.events.length, 1);
  assert.strictEqual(fs.readFileSync(path.join(home, "state", "monitor-state.json"), "utf8"), before);
  // 清理：dryRun 没动基线，随后非演练轮也不会因此多发（9 未观测为基线，计数仍 5）
  const r2 = await monitorOnce({
    configOverride: makeConfig(),
    probeStoreImpl: probe({ "平台协同工单": 5 }),
    sendTextImpl: async () => {}
  });
  assert.strictEqual(r2.events.length, 0);
});

test("真实链路：登录失效→真实发送 login_required", async () => {
  const sent = [];
  const r = await monitorOnce({
    configOverride: makeConfig(),
    probeStoreImpl: probe({}, STATUS.LOGIN_REQUIRED),
    sendTextImpl: async (url, name, content) => { sent.push(content); }
  });
  assert.strictEqual(r.events[0].type, "login_required");
  assert.match(sent[0], /登录态已失效/);
});

test("真实CLI：配置缺失→中文可行动报错（子进程隔离运行目录）", () => {
  const { execFileSync } = require("child_process");
  const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "wo14-cli-"));
  let out = "";
  try {
    execFileSync(process.execPath, [path.join(__dirname, "..", "src", "cli", "startCli.js"), "once"], {
      env: { ...process.env, WORK_ORDER_HOME: emptyHome, WORK_ORDER_CONFIG: path.join(emptyHome, "nope.json") },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
    });
    assert.fail("应该报错退出");
  } catch (error) {
    out = String(error.stdout || "") + String(error.stderr || "");
  }
  assert.match(out, /未找到配置文件/);
  assert.match(out, /platform-config/);
});
