const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const {
  判断诺诺登录就绪,
  合并本地诺诺登录状态,
  构建下载中心窗口命令,
  启动下载中心服务,
  读取下载中心外部服务状态,
} = require("./启动下载中心");

test("下载中心独立窗口启动命令会最大化并跳过批处理二次拉起", () => {
  const 命令 = 构建下载中心窗口命令({
    项目目录路径: "D:\\发票项目\\3.通用发票下载中心",
    启动文件路径: "D:\\发票项目\\3.通用发票下载中心\\启动下载中心.bat",
  });
  assert.match(命令, /^start ".*" \/max \/d /);
  assert.match(命令, /启动下载中心\.bat" --launcher-maximized$/);
});

test("判断诺诺登录就绪：只认诺诺登录条目的 ready 状态", () => {
  assert.equal(判断诺诺登录就绪({
    items: [
      { name: "下载服务", status: "ready" },
      { name: "诺诺登录", status: "ready" },
    ],
  }), true);
  assert.equal(判断诺诺登录就绪({
    items: [
      { name: "下载服务", status: "ready" },
      { name: "诺诺登录", status: "unknown" },
    ],
  }), false);
  assert.equal(判断诺诺登录就绪(null), false);
});

test("合并本地诺诺登录状态：接口未同步但本地文件已就绪时采用本地文件", () => {
  const 接口状态 = { status: "unknown", label: "未检查", detail: "" };
  const 本地文件 = { status: "ready", label: "可用", detail: "主体 2 个" };
  const 合并结果 = 合并本地诺诺登录状态(接口状态, 本地文件);
  assert.equal(合并结果.status, "ready");
  assert.match(合并结果.detail, /本地状态直读/);

  const 已就绪结果 = 合并本地诺诺登录状态({ status: "ready", label: "可用" }, 本地文件);
  assert.equal(已就绪结果.status, "ready");
  assert.ok(!已就绪结果.detail.includes("本地状态直读"));
});

test("启动下载中心服务：使用当前 Node 进程后台启动 startServer.js", () => {
  let 启动参数 = null;
  const 入口 = 启动下载中心服务({
    fileExists: () => true,
    launchProcess: (命令, 参数, 选项) => {
      启动参数 = { 命令, 参数, 选项 };
      return { unref() {} };
    },
  });
  assert.ok(入口.endsWith(path.join("src", "server", "startServer.js")));
  assert.equal(启动参数.命令, process.execPath);
  assert.equal(启动参数.参数.length, 1);
  assert.ok(启动参数.选项.detached);
  assert.equal(启动参数.选项.stdio, "ignore");
  assert.equal(启动参数.选项.windowsHide, true);
});

test("首页状态：快照非可用时探测成功即恢复可用", async () => {
  const 调用路径 = [];
  const 结果 = await 读取下载中心外部服务状态({
    读取本地状态: () => ({ status: "error", label: "失效", detail: "旧快照", updatedAt: "2026-01-01T00:00:00.000Z" }),
    发送GET: async (路径) => {
      调用路径.push(路径);
      if (路径 === "/api/health") return { ok: true, service: "通用发票下载中心" };
      if (路径 === "/api/login/status") return { status: "error", label: "失效", detail: "旧快照" };
      if (路径 === "/api/login/probe") return { ok: true, invoiceSubjectCount: 2 };
      return {};
    },
  });
  assert.deepEqual(调用路径, ["/api/health", "/api/login/status", "/api/login/probe"]);
  assert.equal(结果.status, "ready");
  assert.equal(结果.items.find((item) => item.name === "诺诺登录").status, "ready");
  assert.match(结果.items.find((item) => item.name === "诺诺登录").detail, /主体 2 个/);
  assert.equal(结果.items.find((item) => item.name === "发票下载").status, "ready");
});

test("首页状态：快照已可用时不重复探测", async () => {
  const 调用路径 = [];
  const 结果 = await 读取下载中心外部服务状态({
    读取本地状态: () => ({ status: "ready", label: "可用", detail: "主体 2 个" }),
    发送GET: async (路径) => {
      调用路径.push(路径);
      if (路径 === "/api/health") return { ok: true, service: "通用发票下载中心" };
      if (路径 === "/api/login/status") return { status: "ready", label: "可用", detail: "主体 2 个" };
      return {};
    },
  });
  assert.deepEqual(调用路径, ["/api/health", "/api/login/status"]);
  assert.equal(结果.status, "ready");
});

test("首页状态：探测接口不存在（旧版服务）时保持原快照不报错", async () => {
  const 结果 = await 读取下载中心外部服务状态({
    读取本地状态: () => ({ status: "error", label: "失效", detail: "旧快照" }),
    发送GET: async (路径) => {
      if (路径 === "/api/health") return { ok: true, service: "通用发票下载中心" };
      if (路径 === "/api/login/status") return { status: "error", label: "失效", detail: "旧快照" };
      if (路径 === "/api/login/probe") throw new Error("接口不存在");
      return {};
    },
  });
  assert.equal(结果.status, "error");
  assert.equal(结果.items.find((item) => item.name === "诺诺登录").status, "error");
});
