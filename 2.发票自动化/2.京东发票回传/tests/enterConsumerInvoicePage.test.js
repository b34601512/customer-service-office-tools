const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { 进入消费者发票页面, 读取消费者发票入口状态 } = require('../src/consumerInvoice/enterConsumerInvoicePage');
const { 禁用常见遮挡浮层 } = require('../src/consumerInvoice/allInvoiceTab');
const { 目标页面地址 } = require('../src/browser/targetPageIdentity');

const 错误页面地址 = 'https://shop.jd.com/jdm/cz/index-ware?mainType=canJoinWare';
const 登录跳转页面地址 = `https://loginmyseller.jd.com/login?redirect_url=${encodeURIComponent(目标页面地址)}`;

function 构建消费者发票页HTML() {
  // 该函数模拟真正消费者发票页，只保留进门确认需要的标题和顶部标签。
  return `
    <style>
      .invoice-tabs { display: flex; align-items: center; height: 36px; gap: 24px; }
      .invoice-tabs button { height: 30px; border: 0; background: white; }
    </style>
    <h1>消费者发票管理</h1>
    <div class="invoice-tabs">
      <button type="button">全部</button>
      <button type="button">近3个月待开票 (60)</button>
    </div>
  `;
}

function 构建错误业务页HTML() {
  // 该函数模拟京东其它业务页里混入消费者发票帮助文案的真实误判场景。
  return `
    <title>商家可报价</title>
    <main>
      <h1>商家可报价</h1>
      <nav>京麦 商家 成长 帮助 服务市场 更多 全部</nav>
      <section>消费者发票设置指南 消费者发票入口设置</section>
      <section>近3个月待开票字段只是帮助文案，不是顶部标签</section>
    </main>
  `;
}

function 构建登录跳转页HTML() {
  // 该函数模拟 redirect_url 指向消费者发票页的京东登录中转页。
  return `
    <title>京东登录</title>
    <main>
      <h1>京东登录</h1>
      <p>请先登录京东商家后台</p>
      <input id="loginname" type="text" placeholder="请输入账号名/邮箱">
      <input type="password" placeholder="请输入登录密码">
      <button
        id="login-submit"
        class="rcd-button rcd-button--primary password__submit"
        onclick="window.loginSubmitCount += 1"
      >立即登录</button>
    </main>
    <script>window.loginSubmitCount = 0;</script>
  `;
}

async function 注册页面路由(page) {
  // 该函数拦截两类京东页面，让测试不依赖真实后台。
  await page.route(错误页面地址, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: 构建错误业务页HTML(),
    });
  });
  await page.route(登录跳转页面地址, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: 构建登录跳转页HTML(),
    });
  });
  await page.route(目标页面地址, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: 构建消费者发票页HTML(),
    });
  });
}

test('错误业务页即使包含发票文案，也不会被判定为消费者发票页', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await 注册页面路由(page);
  await page.goto(错误页面地址);

  const 状态 = await 读取消费者发票入口状态(page, 目标页面地址);

  await browser.close();
  assert.equal(状态.ready, false);
  assert.equal(状态.isTargetUrl, false);
  assert.equal(状态.hasAllTab, false);
});

test('进门函数会把错误业务页带回消费者发票页并确认站稳', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await 注册页面路由(page);
  await page.goto(错误页面地址);

  const 状态 = await 进入消费者发票页面(page, {
    目标地址: 目标页面地址,
    timeoutMs: 5_000,
    intervalMs: 100,
  });

  await browser.close();
  assert.equal(状态.ready, true);
  assert.equal(page.url(), 目标页面地址);
});

test('登录跳转页指向消费者发票页时，进门函数立即报告登录失效且不重复打开目标页', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  let 目标页请求次数 = 0;
  await 注册页面路由(page);
  await page.route(目标页面地址, async (route) => {
    目标页请求次数 += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: 构建消费者发票页HTML(),
    });
  });

  try {
    await page.goto(登录跳转页面地址);
    await assert.rejects(
      () => 进入消费者发票页面(page, {
        目标地址: 目标页面地址,
        timeoutMs: 300,
        intervalMs: 50,
      }),
      /登录态失效/,
    );

    assert.equal(目标页请求次数, 0);
    assert.equal(page.url(), 登录跳转页面地址);
  } finally {
    await browser.close();
  }
});

test('目标页稍后跳登录页时，唯一进门流程会填写真实表单并点击立即登录', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  let 目标页请求次数 = 0;
  await 注册页面路由(page);
  await page.route(目标页面地址, async (route) => {
    目标页请求次数 += 1;
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: 目标页请求次数 === 1
        ? `<script>window.setTimeout(() => { window.location.href = ${JSON.stringify(登录跳转页面地址)}; }, 50);</script>`
        : 构建消费者发票页HTML(),
    });
  });

  try {
    await page.goto(目标页面地址);
    const 进入页面任务 = 进入消费者发票页面(page, {
      目标地址: 目标页面地址,
      允许人工登录: true,
      店铺配置: {
        id: 'store-a',
        name: '京东A店',
        username: 'configured-user',
        password: 'configured-password',
      },
      timeoutMs: 5_000,
      intervalMs: 50,
    });

    await page.waitForFunction(() => (
      document.querySelector('#loginname')?.value === 'configured-user'
      && document.querySelector('input[type="password"]')?.value === 'configured-password'
      && window.loginSubmitCount === 1
    ));
    assert.equal(await page.evaluate(() => window.loginSubmitCount), 1);

    await page.goto(目标页面地址);
    const 状态 = await 进入页面任务;

    assert.equal(状态.ready, true);
    assert.equal(目标页请求次数, 2);
  } finally {
    await browser.close();
  }
});

test('登录失效且店铺缺少密码时会直接说明配置问题', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await 注册页面路由(page);
  try {
    await page.goto(登录跳转页面地址);
    await assert.rejects(
      () => 进入消费者发票页面(page, {
        目标地址: 目标页面地址,
        允许人工登录: true,
        店铺配置: {
          id: 'store-a',
          name: '京东A店',
          username: 'configured-user',
          password: '',
        },
        timeoutMs: 1_000,
        intervalMs: 50,
      }),
      /京东A店.*未配置京东登录密码/,
    );
  } finally {
    await browser.close();
  }
});

test('京东菜单更新遮挡弹窗会在操作顶部标签前自动关闭', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <html>
        <body>
          <button id="all-tab" onclick="window.allTabClicked = true">全部</button>
          <button>近3个月待开票 (60)</button>
          <div class="jm-guide-mask" style="position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:9999;background:rgba(0,0,0,.35)">
            <section class="jm-guide-dialog" style="position:fixed;left:80px;top:120px;width:600px;background:#fff">
              <h2>一级菜单更新调整</h2>
              <p>新菜单将于2026年6月陆续生效中</p>
              <button id="known-button" onclick="document.querySelector('.jm-guide-mask').remove()">知道了</button>
            </section>
          </div>
          <script>window.allTabClicked = false;</script>
        </body>
      </html>
    `);

    const 清理结果 = await 禁用常见遮挡浮层(page);
    await page.click('#all-tab');

    assert.equal(清理结果.closedCount, 1);
    assert.equal(await page.locator('.jm-guide-mask').count(), 0);
    assert.equal(await page.evaluate(() => window.allTabClicked), true);
  } finally {
    await browser.close();
  }
});

test('京东通知类确定弹窗会自动关闭', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <html>
        <body>
          <div role="dialog" aria-modal="true" class="jd-modal" style="position:fixed;left:200px;top:80px;z-index:2000;background:#fff">
            <h2>系统更新提示</h2>
            <p>发票页面菜单有更新，请先确认提示。</p>
            <button onclick="this.closest('[role=dialog]').remove()">确定</button>
          </div>
        </body>
      </html>
    `);

    const 清理结果 = await 禁用常见遮挡浮层(page);

    assert.equal(清理结果.closedCount, 1);
    assert.equal(await page.locator('[role="dialog"]').count(), 0);
  } finally {
    await browser.close();
  }
});

test('遮挡弹窗清理不会误点业务表格里的驳回关闭', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <html>
        <body>
          <table>
            <tr>
              <td>3551466002929555</td>
              <td><a id="reject-close" href="#" onclick="window.rejectCloseClicked = true">驳回关闭</a></td>
            </tr>
          </table>
          <script>window.rejectCloseClicked = false;</script>
        </body>
      </html>
    `);

    const 清理结果 = await 禁用常见遮挡浮层(page);

    assert.equal(清理结果.closedCount, 0);
    assert.equal(await page.evaluate(() => window.rejectCloseClicked), false);
  } finally {
    await browser.close();
  }
});

test('遮挡弹窗清理不会确认危险业务弹窗', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent(`
      <html>
        <body>
          <div role="dialog" aria-modal="true" class="jd-modal" style="position:fixed;left:200px;top:80px;z-index:2000;background:#fff">
            <h2>删除订单确认</h2>
            <p>确认删除订单后不可恢复。</p>
            <button onclick="window.deleteConfirmed = true">确定</button>
          </div>
          <script>window.deleteConfirmed = false;</script>
        </body>
      </html>
    `);

    const 清理结果 = await 禁用常见遮挡浮层(page);

    assert.equal(清理结果.closedCount, 0);
    assert.equal(await page.evaluate(() => window.deleteConfirmed), false);
    assert.equal(await page.locator('[role="dialog"]').count(), 1);
  } finally {
    await browser.close();
  }
});
