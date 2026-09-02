const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  读取店铺摘要,
  统计订单记录,
  读取订单摘要,
  读取最近任务摘要,
  读取平台状态摘要,
  读取下载中心状态摘要,
} = require("./平台状态汇总");

function 创建临时项目目录() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "发票自动化状态汇总测试-"));
}

test("店铺摘要只统计启用状态，不读取密码字段", () => {
  const 临时目录 = 创建临时项目目录();
  try {
    const 数据目录 = path.join(临时目录, "data");
    fs.mkdirSync(数据目录);
    fs.writeFileSync(path.join(数据目录, "stores.json"), JSON.stringify({
      stores: [
        { id: "a", name: "A店", password: "secret-a", enabled: true },
        { id: "b", name: "B店", password: "secret-b", enabled: false },
      ],
    }), "utf8");

    const 摘要 = 读取店铺摘要(临时目录);
    assert.equal(摘要.店铺总数, 2);
    assert.equal(摘要.启用店铺数, 1);
    assert.deepEqual(摘要.店铺名称列表, ["A店", "B店"]);
    assert.ok(!JSON.stringify(摘要).includes("secret"));
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test("订单统计按四阶段工作流状态归类并提取最近失败原因", () => {
  const 统计 = 统计订单记录([
    { workflowStatus: "pending" },
    { workflowStatus: "processing" },
    { workflowStatus: "invoice_registered" },
    { workflowStatus: "handled" },
    { workflowStatus: "other" },
    { workflowStatus: "pending", lastReturnAttempt: { status: "error", message: "诺诺登录态已失效" } },
  ]);
  assert.equal(统计.订单总数, 6);
  assert.equal(统计.待处理, 2);
  assert.equal(统计.处理中, 1);
  assert.equal(统计.已登记, 1);
  assert.equal(统计.已处理, 1);
  assert.equal(统计.其他, 1);
  assert.equal(统计.失败尝试数, 1);
  assert.match(统计.最近失败原因, /诺诺登录态已失效/);
});

test("平台状态摘要可读取天猫规格的项目状态", () => {
  const 临时根目录 = 创建临时项目目录();
  try {
    const 项目目录 = path.join(临时根目录, "4.天猫发票回传");
    fs.mkdirSync(path.join(项目目录, "data"), { recursive: true });
    fs.writeFileSync(path.join(项目目录, "启动测试.bat"), "echo ok\r\n", "utf8");
    fs.writeFileSync(path.join(项目目录, "data", "stores.json"), JSON.stringify({
      stores: [
        { id: "s1", name: "A店", enabled: true },
        { id: "s2", name: "B店", enabled: false },
      ],
    }), "utf8");
    fs.writeFileSync(path.join(项目目录, "data", "invoice-order-records.json"), JSON.stringify({
      orders: {
        "s1:o1": { workflowStatus: "pending" },
        "s1:o2": { workflowStatus: "invoice_registered", lastReturnAttempt: { status: "error", message: "下载失败：登录失效" } },
        "s2:o3": { workflowStatus: "handled" },
      },
    }), "utf8");

    const 摘要 = 读取平台状态摘要(
      { 菜单编号: "3", 项目名称: "天猫发票回传", 项目目录名称: "4.天猫发票回传", 启动文件名称: "启动测试.bat" },
      { 总目录: 临时根目录 },
    );
    assert.equal(摘要.ok, true);
    assert.equal(摘要.店铺总数, 2);
    assert.equal(摘要.启用店铺数, 1);
    assert.equal(摘要.订单总数, 3);
    assert.equal(摘要.待处理, 1);
    assert.equal(摘要.已登记, 1);
    assert.equal(摘要.已处理, 1);
    assert.equal(摘要.失败尝试数, 1);
  } finally {
    fs.rmSync(临时根目录, { recursive: true, force: true });
  }
});

test("最近任务摘要优先使用 lastRunSummary", () => {
  const 临时目录 = 创建临时项目目录();
  try {
    const 数据目录 = path.join(临时目录, "data");
    fs.mkdirSync(数据目录);
    fs.writeFileSync(path.join(数据目录, "store-results.json"), JSON.stringify({
      lastRunSummary: {
        status: "success",
        storeCount: 5,
        checkedStoreCount: 5,
        failedStoreCount: 0,
        finishedAt: "2026-08-15T02:16:29.602Z",
      },
    }), "utf8");
    const 摘要 = 读取最近任务摘要(临时目录, "store-results.json");
    assert.equal(摘要.任务记录存在, true);
    assert.equal(摘要.状态, "成功");
    assert.match(摘要.说明, /5 家/);
  } finally {
    fs.rmSync(临时目录, { recursive: true, force: true });
  }
});

test("下载中心状态摘要读取配置存在性和发票索引数，不输出密码", () => {
  const 临时根目录 = 创建临时项目目录();
  try {
    const 下载中心目录 = path.join(临时根目录, "3.通用发票下载中心");
    fs.mkdirSync(path.join(下载中心目录, "data"), { recursive: true });
    fs.mkdirSync(path.join(下载中心目录, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(下载中心目录, "data", "invoice-system-config.json"), JSON.stringify({
      provider: "nuonuo",
      username: "19900000000",
      password: "do-not-print",
    }), "utf8");
    fs.writeFileSync(path.join(下载中心目录, "data", "invoice-file-index.json"), JSON.stringify({
      invoices: { a: {}, b: {}, c: {} },
    }), "utf8");
    fs.writeFileSync(path.join(下载中心目录, "runtime", "nuonuo-login-status.json"), JSON.stringify({
      status: "ready",
      label: "可用",
      detail: "主体 2 个",
      updatedAt: "2026-08-15T06:06:24.302Z",
    }), "utf8");

    const 摘要 = 读取下载中心状态摘要(临时根目录);
    assert.equal(摘要.目录存在, true);
    assert.equal(摘要.账号已配置, true);
    assert.equal(摘要.发票索引数, 3);
    assert.equal(摘要.诺诺状态.status, "ready");
    assert.ok(!JSON.stringify(摘要).includes("do-not-print"));
  } finally {
    fs.rmSync(临时根目录, { recursive: true, force: true });
  }
});
