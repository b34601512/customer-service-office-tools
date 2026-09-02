const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server/createServer');
const { 检查下载中心服务已运行, 监听服务 } = require('../src/server/startServer');
const { 规范化发票系统配置 } = require('../src/config/invoiceSystemConfig');

function listen(server) {
  // 该函数使用随机端口启动测试服务，避免占用真实端口。
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function close(server) {
  // 该函数确保每个测试结束后释放端口。
  return new Promise((resolve) => server.close(resolve));
}

test('健康检查接口可用', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
  } finally {
    await close(server);
  }
});

test('管理网页入口不再提供页面', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 404);
    const data = await response.json();
    assert.equal(data.ok, false);
  } finally {
    await close(server);
  }
});

test('启动入口能识别下载中心已经运行', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    assert.equal(await 检查下载中心服务已运行(port), true);
  } finally {
    await close(server);
  }
});

test('服务状态接口返回当前进程信息', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/service/status`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.service, '通用发票下载中心');
    assert.equal(data.pid, process.pid);
    assert.match(data.projectRoot, /3\.通用发票下载中心/);
  } finally {
    await close(server);
  }
});

test('退出后台接口会调用统一退出函数', async () => {
  let shutdownReason = '';
  const server = createServer({
    requestShutdown: async (reason) => {
      shutdownReason = reason;
    },
  });
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/service/shutdown`, {
      method: 'POST',
      body: '{}',
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.match(shutdownReason, /接口请求退出下载中心/);
  } finally {
    await close(server);
  }
});

test('启动入口能把端口占用错误交给上层处理', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const conflictServer = createServer();
    await assert.rejects(
      () => 监听服务(conflictServer, port),
      (error) => error.code === 'EADDRINUSE',
    );
  } finally {
    await close(server);
  }
});

test('本地发票列表接口可用', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/invoices/local`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(Array.isArray(data.invoices), true);
  } finally {
    await close(server);
  }
});

test('下载文件夹路径接口可用', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/downloads/path`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.match(data.downloadsDirectory, /downloads/);
  } finally {
    await close(server);
  }
});

test('登录探测接口：探测成功时更新为可用并受冷却限制', async () => {
  let 探测次数 = 0;
  const server = createServer({
    readInvoiceSystemConfig: () => 规范化发票系统配置({
      provider: 'nuonuo',
      targetUrl: 'https://work.nuonuo.com/index',
      username: 'tester',
      password: 'secret',
    }),
    probeNuonuoLogin: async () => {
      探测次数 += 1;
      return { ok: true, invoiceSubjectCount: 2 };
    },
    probeCooldownMs: 60_000,
  });
  await listen(server);
  try {
    const port = server.address().port;
    const 首次 = await (await fetch(`http://127.0.0.1:${port}/api/login/probe`)).json();
    assert.equal(首次.ok, true);
    assert.equal(首次.invoiceSubjectCount, 2);
    assert.equal(探测次数, 1);
    const 状态 = await (await fetch(`http://127.0.0.1:${port}/api/login/status`)).json();
    assert.equal(状态.status, 'ready');
    assert.match(String(状态.detail || ''), /主体 2 个/);
    // 冷却期内再次探测直接返回受限制，不重复启动无头浏览器。
    const 冷却 = await (await fetch(`http://127.0.0.1:${port}/api/login/probe`)).json();
    assert.equal(冷却.throttled, true);
    assert.equal(探测次数, 1);
  } finally {
    await close(server);
  }
});

test('登录探测接口：探测失败时保持原状态且不报错', async () => {
  let 探测次数 = 0;
  const server = createServer({
    readInvoiceSystemConfig: () => 规范化发票系统配置({
      provider: 'nuonuo',
      targetUrl: 'https://work.nuonuo.com/index',
      username: 'tester',
      password: 'secret',
    }),
    probeNuonuoLogin: async () => {
      探测次数 += 1;
      return { ok: false, message: '登录态已失效' };
    },
    probeCooldownMs: 0,
  });
  await listen(server);
  try {
    const port = server.address().port;
    const 结果 = await (await fetch(`http://127.0.0.1:${port}/api/login/probe`)).json();
    assert.equal(结果.ok, false);
    assert.match(String(结果.message || ''), /登录态已失效/);
    assert.equal(探测次数, 1);
  } finally {
    await close(server);
  }
});

test('配置接口不会返回完整账号和密码', async () => {
  const server = createServer();
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/config`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(data.config, 'username'), false);
    assert.equal(Object.hasOwn(data.config, 'password'), false);
    assert.equal(Object.hasOwn(data.config, 'hasPassword'), true);
  } finally {
    await close(server);
  }
});

test('配置接口支持局部保存检索天数且保留账号密码', async () => {
  let currentConfig = 规范化发票系统配置({
    provider: 'nuonuo',
    targetUrl: 'https://work.nuonuo.com/index',
    username: 'tester',
    password: 'secret',
    invoiceSearchRangeDays: 30,
  });
  const server = createServer({
    readInvoiceSystemConfig: () => currentConfig,
    saveInvoiceSystemConfig: (config) => {
      currentConfig = 规范化发票系统配置(config);
      return currentConfig;
    },
  });
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/config`, {
      method: 'POST',
      body: JSON.stringify({ invoiceSearchRangeDays: 45 }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(currentConfig.username, 'tester');
    assert.equal(currentConfig.password, 'secret');
    assert.equal(currentConfig.invoiceSearchRangeDays, 45);
    assert.equal(data.config.invoiceSearchRangeDays, 45);
    assert.equal(Object.hasOwn(data.config, 'password'), false);
  } finally {
    await close(server);
  }
});

test('检索范围专用接口只保存天数且保留账号密码', async () => {
  let currentConfig = 规范化发票系统配置({
    provider: 'nuonuo',
    targetUrl: 'https://work.nuonuo.com/index',
    username: 'tester',
    password: 'secret',
    invoiceSearchRangeDays: 30,
  });
  const server = createServer({
    readInvoiceSystemConfig: () => currentConfig,
    saveInvoiceSystemConfig: (config) => {
      currentConfig = 规范化发票系统配置(config);
      return currentConfig;
    },
  });
  await listen(server);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/config/search-range`, {
      method: 'POST',
      body: JSON.stringify({ invoiceSearchRangeDays: 60 }),
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(currentConfig.username, 'tester');
    assert.equal(currentConfig.password, 'secret');
    assert.equal(currentConfig.invoiceSearchRangeDays, 60);
    assert.equal(data.config.invoiceSearchRangeDays, 60);
    assert.equal(Object.hasOwn(data.config, 'password'), false);
  } finally {
    await close(server);
  }
});
