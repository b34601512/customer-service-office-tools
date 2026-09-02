const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const {
  是天猫待回传列表文本,
  读取天猫待回传页面状态,
  检测滑块验证,
  构建天猫回传截图路径,
  提取行内发票类型,
  提取行内发票金额,
  提取行内发票抬头,
  提取行内申请时间,
  提取行内赔付倒计时,
  提取行内批准状态,
  构建天猫财务开票参考,
  读取已识别发票号码,
  等待已识别发票号码,
  选择目标发票类型,
  选择天猫发票类型,
  导出天猫待回传订单,
  确认天猫批量导出按钮可用,
  读取当前页发票订单状态摘要,
  构建天猫无可回传订单错误消息,
  读取天猫录入发票错误文本列表,
  等待天猫完成开票结果,
  关闭天猫录入发票抽屉,
} = require('../src/invoiceReturn/tmallInvoicePage');

test('待回传页面状态会优先识别登录拦截', () => {
  const state = 读取天猫待回传页面状态(
    'https://loginmyseller.taobao.com/?redirect_url=https%3A%2F%2Fmyseller.taobao.com%2Fhome.htm',
    '欢迎登录 密码登录',
  );

  assert.equal(state, 'login');
});

test('待回传列表文本必须有批量导出和订单或空列表', () => {
  assert.equal(是天猫待回传列表文本('批量导出 2701832306020003363 录入发票'), true);
  assert.equal(是天猫待回传列表文本('批量导出 暂无数据'), true);
  assert.equal(是天猫待回传列表文本('欢迎登录 密码登录'), false);
});

test('滑块验证可以通过文案或组件识别', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main>请拖动滑块完成验证</main>');
    assert.equal(await 检测滑块验证(page), true);

    await page.setContent('<main>批量导出 暂无数据</main>');
    assert.equal(await 检测滑块验证(page), false);

    await page.setContent('<main><div id="nc_1_wrapper"><span class="nc_iconfont">nc</span></div></main>');
    assert.equal(await 检测滑块验证(page), true);

    await page.setContent('<main>普通页面</main>');
    assert.equal(await 检测滑块验证(page), false);
  } finally {
    await browser.close();
  }
});

test('天猫回传截图路径按店铺和订单生成安全文件名', () => {
  const screenshotPath = 构建天猫回传截图路径({
    storeId: 'tmall:store/1',
    orderNumber: '2701832306020003363',
  }, 'success');

  assert.match(screenshotPath, /tmall-invoice-return-tmall-store-1-2701832306020003363-success-/);
  assert.match(screenshotPath, /\.png$/);
});

test('表格行文本可以提取发票类型、金额和抬头', () => {
  const rowText = '2701832306020003363 2026-06-27 3天18小时 免自动赔 文勇欢 增值税电子普通发票 441.00 详情 已准 录入发票';
  const invoiceType = 提取行内发票类型(rowText);

  assert.equal(invoiceType, '增值税电子普通发票');
  assert.equal(提取行内发票金额(rowText), '441.00');
  assert.equal(提取行内发票抬头(rowText, invoiceType), '文勇欢');
  assert.equal(提取行内申请时间(rowText), '2026-06-27');
  assert.equal(提取行内赔付倒计时(rowText), '3天18小时');
  assert.equal(提取行内批准状态(rowText), '已批准');
});

test('天猫财务开票参考按 7 个工作日估算', () => {
  const reference = 构建天猫财务开票参考(
    '2026-07-01',
    new Date(2026, 6, 8),
  );

  assert.equal(reference, '财务参考：已过 5 个工作日，常规约 7 个工作日，预计 2026-07-10 前后');
});

test('天猫财务开票参考能提示超过常规周期', () => {
  const reference = 构建天猫财务开票参考(
    '2026-07-01',
    new Date(2026, 6, 13),
  );

  assert.equal(reference, '财务参考：已过 8 个工作日，超过常规 7 个工作日');
});

test('20位发票号码会选择全电普通发票', () => {
  const type = 选择目标发票类型({
    invoiceNumber: '26952000002820665311',
    invoiceType: '增值税电子普通发票',
  });

  assert.equal(type, '全电普通发票');
});

test('20位专票号码会选择全电专用发票', () => {
  const type = 选择目标发票类型({
    invoiceNumber: '26952000002820665311',
    invoiceType: '增值税电子专用发票',
  });

  assert.equal(type, '全电专用发票');
});

test('非20位号码优先保持原发票类型', () => {
  const type = 选择目标发票类型({
    invoiceNumber: '12345678',
    invoiceType: '增值税电子普通发票',
  });

  assert.equal(type, '增值税电子普通发票');
});

test('发票号码优先读取页面输入框真实值', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input id="invoiceNo" value="26952000002820198241" />
      <main>发票号码 发票抬头 开票日期</main>
    `);

    assert.equal(await 读取已识别发票号码(page), '26952000002820198241');
  } finally {
    await browser.close();
  }
});

test('等待发票号码识别不会把文件名出现当成解析完成', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input id="invoiceNo" value="" />
      <main>3310628557587006996.pdf</main>
      <script>
        setTimeout(() => {
          document.querySelector('#invoiceNo').value = '26952000002820387706';
        }, 120);
      </script>
    `);

    assert.equal(await 等待已识别发票号码(page, 2000), '26952000002820387706');
  } finally {
    await browser.close();
  }
});

test('导出等待过程中页面关闭不会产生未处理下载监听异常', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tmall-export-close-'));
  const unhandledRejections = [];
  const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button>批量导出</button>
      <main>批量导出 2701832306020003363 录入发票</main>
    `);
    const exportPromise = 导出天猫待回传订单(page, outputDirectory, {
      confirmTimeoutMs: 500,
      downloadTimeoutMs: 500,
    });
    exportPromise.catch(() => {});
    await page.waitForTimeout(80);
    await page.close();

    await assert.rejects(
      exportPromise,
      /等待批量导出确认弹窗超时|页面或浏览器被关闭|Target page, context or browser has been closed/,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(unhandledRejections.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    await browser.close();
  }
});

test('批量导出按钮禁用且没有订单时会给出中文业务原因', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button disabled>批量导出</button>
      <main>批量导出 暂无数据</main>
    `);

    await assert.rejects(
      () => 确认天猫批量导出按钮可用(page),
      /判定规则：程序只回传操作列出现“录入发票”的订单/,
    );
  } finally {
    await browser.close();
  }
});

test('页面有待同意订单但没有录入发票时会说明判定规则', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table>
        <tr>
          <td>3309423746365011295</td>
          <td>南京安正软件工程有限责任公司</td>
          <td>69.00</td>
          <td>详情 同意</td>
        </tr>
        <tr>
          <td>5120052913784024022</td>
          <td>顺丰速运有限公司</td>
          <td>1464.10</td>
          <td>详情 同意</td>
        </tr>
      </table>
    `);

    const summary = await 读取当前页发票订单状态摘要(page);
    const message = 构建天猫无可回传订单错误消息(summary);

    assert.equal(summary.visibleOrderCount, 2);
    assert.equal(summary.returnableOrderCount, 0);
    assert.equal(summary.pendingAgreeOrderCount, 2);
    assert.match(message, /当前页面识别到 2 个订单，其中 0 个包含“录入发票”/);
    assert.match(message, /待同意 2 个/);
    assert.match(message, /3309423746365011295、5120052913784024022/);
    assert.match(message, /客服登记、财务开票/);
  } finally {
    await browser.close();
  }
});

test('批量导出按钮禁用但页面有订单时会提示页面状态异常', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button disabled>批量导出</button>
      <table>
        <tr>
          <td>2701832306020003363</td>
          <td>免自动赔 文勇欢 增值税电子普通发票 441.00</td>
          <td>录入发票</td>
        </tr>
      </table>
    `);

    await assert.rejects(
      () => 确认天猫批量导出按钮可用(page),
      /页面已有 1 单待回传订单，但批量导出按钮仍是禁用状态/,
    );
  } finally {
    await browser.close();
  }
});

test('20位发票号码会点击外层全电普通发票标签', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <input id="invoiceNo" value="26952000002820198241" />
      <div id="warning">您上传的发票号码为20位数字，应为全电发票，请确认发票类型是否选错</div>
      <div role="checkbox" aria-checked="true" class="next-tag checked">
        <div>增值税电子普通发票</div>
      </div>
      <div role="checkbox" aria-checked="false" class="next-tag">
        <div>全电普通发票</div>
      </div>
      <script>
        for (const tag of document.querySelectorAll('[role="checkbox"]')) {
          tag.addEventListener('click', () => {
            for (const item of document.querySelectorAll('[role="checkbox"]')) {
              item.setAttribute('aria-checked', 'false');
              item.className = item.className.replace(/\\bchecked\\b/g, '').trim();
            }
            tag.setAttribute('aria-checked', 'true');
            tag.className = tag.className + ' checked';
            document.querySelector('#warning').remove();
          });
        }
      </script>
    `);

    const result = await 选择天猫发票类型(page, { invoiceType: '增值税电子普通发票' });
    const targetChecked = await page.evaluate(() => {
      const tag = Array.from(document.querySelectorAll('[role="checkbox"]'))
        .find((element) => String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim() === '全电普通发票');
      return tag?.getAttribute('aria-checked') || '';
    });

    assert.deepEqual(result, {
      invoiceNumber: '26952000002820198241',
      targetType: '全电普通发票',
    });
    assert.equal(targetChecked, 'true');
  } finally {
    await browser.close();
  }
});

test('完成开票结果会直接抛出页面红字错误', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section>
        <h2>录入发票信息</h2>
        <strong>5121956198949007738</strong>
        <span>请填写发票代码</span>
        <span>发票号码需为8位数字</span>
        <button>完成开票</button>
      </section>
    `);

    const errorTexts = await 读取天猫录入发票错误文本列表(page);
    await assert.rejects(
      () => 等待天猫完成开票结果(page, '5121956198949007738', 500),
      /请填写发票代码；发票号码需为8位数字/,
    );
    assert.deepEqual(errorTexts, ['请填写发票代码', '发票号码需为8位数字']);
  } finally {
    await browser.close();
  }
});

test('失败后可以关闭录入发票抽屉', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <div id="drawer">
          <a class="next-drawer-close" role="button">关闭</a>
          <h2>录入发票信息</h2>
          <button>完成开票</button>
        </div>
        <script>
          document.querySelector('.next-drawer-close').addEventListener('click', () => {
            document.querySelector('#drawer').remove();
          });
        </script>
      </main>
    `);

    assert.equal(await 关闭天猫录入发票抽屉(page, 1000), true);
    assert.equal((await page.locator('body').innerText()).includes('录入发票信息'), false);
  } finally {
    await browser.close();
  }
});
