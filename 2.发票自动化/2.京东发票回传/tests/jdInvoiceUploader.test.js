const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const {
  页面存在京东加载提示,
  切到京东全部发票列表,
  查询京东订单,
  读取京东订单回传前状态,
  等待京东订单查询结果,
  打开京东回传入口,
  上传发票文件,
  补齐京东发票备注,
  读取京东回传提交状态,
  等待京东回传完成,
  规范化上传清单,
} = require('../src/invoiceReturn/jdInvoiceUploader');
const { 读取顶部发票标签状态 } = require('../src/consumerInvoice/allInvoiceTab');

test('京东核对会话允许空上传清单', () => {
  assert.deepEqual(规范化上传清单([]), []);
  assert.throws(
    () => 规范化上传清单([{ orderNumber: '1000000000001', invoiceFilePath: '' }]),
    /缺少订单号或发票文件/,
  );
});

test('京东列表加载中时不会立即判定发票回传入口不存在', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div class="ant-spin ant-spin-spinning">加载中...</div>
          <table>
            <tr>
              <td>3527454014191164</td>
              <td id="operation-cell"></td>
            </tr>
          </table>
          <script>
            window.clickedUpload = false;
            setTimeout(() => {
              document.querySelector('.ant-spin').style.display = 'none';
              document.querySelector('#operation-cell').innerHTML = '<button onclick="window.clickedUpload = true">上传发票</button>';
            }, 300);
          </script>
        </body>
      </html>
    `);

    assert.equal(await 页面存在京东加载提示(page), true);
    await 打开京东回传入口(page, '3527454014191164');
    assert.equal(await page.evaluate(() => window.clickedUpload), true);
  } finally {
    await browser.close();
  }
});

test('京东订单行里的开票链接会被识别为发票回传入口', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <table>
            <tr>
              <td>3527454014191164</td>
              <td><a href="#" onclick="window.clickedInvoiceEntry = true">开票</a></td>
            </tr>
          </table>
          <script>window.clickedInvoiceEntry = false;</script>
        </body>
      </html>
    `);

    const 进度记录 = [];
    await 打开京东回传入口(page, '3527454014191164', {
      item: { orderNumber: '3527454014191164' },
      onProgress: async (item, progress) => 进度记录.push(`${progress.stage}:${item.orderNumber}`),
    });

    assert.equal(await page.evaluate(() => window.clickedInvoiceEntry), true);
    assert.deepEqual(进度记录, [
      'find-order-row:3527454014191164',
      'find-return-entry:3527454014191164',
      'open-return-entry:3527454014191164',
    ]);
  } finally {
    await browser.close();
  }
});

test('京东订单查询会填写订单编号输入框而不是顶部 AI 搜索框', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div class="top-ai-search"><input id="ai-search" type="text" placeholder=""></div>
          <div class="jd-form-item">
            <label>订单编号</label>
            <div><input id="order-number" class="jd-input__inner" type="text" placeholder="请输入"></div>
          </div>
          <button onclick="window.queryClicked = (window.queryClicked || 0) + 1">查询</button>
          <script>window.queryClicked = 0;</script>
        </body>
      </html>
    `);

    await 查询京东订单(page, '3527454014191164');

    assert.equal(await page.locator('#ai-search').evaluate((input) => input.value), '');
    assert.equal(await page.locator('#order-number').evaluate((input) => input.value), '3527454014191164');
    assert.equal(await page.evaluate(() => window.queryClicked), 1);
  } finally {
    await browser.close();
  }
});

test('切到京东全部列表会先等初始加载结束再确认标签激活', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <head>
          <style>
            .invoice-tabs { display: flex; align-items: center; height: 40px; gap: 16px; }
            .jd-tabs__item { height: 40px; line-height: 40px; padding: 0 12px; color: #595959; }
            .jd-tabs__item.is-active { color: #3768fa; }
          </style>
        </head>
        <body>
          <h1>消费者发票</h1>
          <div id="loading" class="ant-spin ant-spin-spinning">加载中...</div>
          <div class="invoice-tabs">
            <div id="all-tab" class="jd-tabs__item is-top" role="tab" aria-selected="false">全部</div>
            <div id="pending-tab" class="jd-tabs__item is-top is-active" role="tab" aria-selected="true">近3个月待开票 (1012)</div>
          </div>
          <script>
            window.loading = true;
            window.activeTab = 'pending';
            window.allTabClicks = [];
            document.querySelector('#all-tab').addEventListener('click', () => {
              window.allTabClicks.push({ duringLoading: window.loading });
              if (window.loading) return;
              window.activeTab = 'all';
              document.querySelector('#all-tab').classList.add('is-active');
              document.querySelector('#all-tab').setAttribute('aria-selected', 'true');
              document.querySelector('#pending-tab').classList.remove('is-active');
              document.querySelector('#pending-tab').setAttribute('aria-selected', 'false');
            });
            setTimeout(() => {
              window.loading = false;
              document.querySelector('#loading').style.display = 'none';
            }, 250);
          </script>
        </body>
      </html>
    `);

    await 切到京东全部发票列表(page);
    const 标签状态 = await 读取顶部发票标签状态(page);

    assert.equal(await page.evaluate(() => window.activeTab), 'all');
    assert.equal(标签状态.allActive, true);
    assert.deepEqual(await page.evaluate(() => window.allTabClicks), [{ duringLoading: false }]);
  } finally {
    await browser.close();
  }
});

test('京东仅以蓝色下划线标识全部标签时也能确认切换成功', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <head>
          <style>
            .invoice-tabs { display: flex; gap: 16px; }
            .invoice-tab { position: relative; padding: 10px 12px; color: rgb(89, 89, 89); }
            .jd-ui-highlight { color: rgb(36, 104, 242); }
            .jd-ui-highlight::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: rgb(36, 104, 242); }
          </style>
        </head>
        <body>
          <h1>消费者发票</h1>
          <div class="invoice-tabs">
            <div id="all-tab" class="invoice-tab" role="tab" aria-selected="false">全部</div>
            <div id="pending-tab" class="invoice-tab jd-ui-highlight" role="tab" aria-selected="false">近3个月待开票 (1012)</div>
          </div>
          <script>
            document.querySelector('#all-tab').addEventListener('click', () => {
              document.querySelector('#all-tab').classList.add('jd-ui-highlight');
              document.querySelector('#pending-tab').classList.remove('jd-ui-highlight');
            });
          </script>
        </body>
      </html>
    `);

    await 切到京东全部发票列表(page);
    const 标签状态 = await 读取顶部发票标签状态(page);

    assert.equal(标签状态.allActive, true);
    assert.equal(标签状态.pendingActive, false);
  } finally {
    await browser.close();
  }
});

test('京东全部列表里开票成功订单会被识别为已开票', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <table>
            <tr>
              <td>3525480018592974</td>
              <td>政府补贴</td>
              <td>催促开票</td>
              <td>电子普票</td>
              <td>￥930.61</td>
              <td>开票成功</td>
              <td><a>查看详情</a></td>
            </tr>
          </table>
        </body>
      </html>
    `);

    const 订单状态 = await 等待京东订单查询结果(page, '3525480018592974');

    assert.equal(订单状态.found, true);
    assert.equal(订单状态.invoiceStatusKind, 'success');
    assert.equal(订单状态.alreadyInvoiced, true);
  } finally {
    await browser.close();
  }
});

test('京东全部列表无数据时会返回明确无数据状态', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div>共 0 条</div>
          <div>暂无数据</div>
        </body>
      </html>
    `);

    const 订单状态 = await 等待京东订单查询结果(page, '3496213014414665');

    assert.equal(订单状态.found, false);
    assert.equal(订单状态.noData, true);
    assert.equal(订单状态.alreadyInvoiced, false);
  } finally {
    await browser.close();
  }
});

test('京东发票备注为空时会在提交前补齐默认备注', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div class="jd-form-item">
            <label>发票备注</label>
            <textarea id="invoice-remark"></textarea>
          </div>
        </body>
      </html>
    `);

    assert.equal(await 补齐京东发票备注(page), true);
    assert.equal(await page.locator('#invoice-remark').inputValue(), '京东');
    assert.equal(await 补齐京东发票备注(page), false);
    assert.equal(await page.locator('#invoice-remark').inputValue(), '京东');
  } finally {
    await browser.close();
  }
});

test('京东上传文件后点击推送给买家而不是再次点击上传发票', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const 临时发票路径 = path.join(os.tmpdir(), `jd-invoice-uploader-${Date.now()}.pdf`);
  fs.writeFileSync(临时发票路径, '%PDF-1.4\n%test\n');
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div role="dialog" aria-label="上传电子发票">
            <button onclick="window.uploadButtonClicked = (window.uploadButtonClicked || 0) + 1">上传发票</button>
            <input class="jd-upload__input" name="file" accept=".pdf" type="file" style="display:none">
            <div class="jd-form-item"><label>发票号码</label><input value="26952000002690108806"></div>
            <div class="jd-form-item"><label>发票抬头</label><input value="黄婷"></div>
            <div class="jd-form-item"><label>发票金额</label><input value="1248.90"></div>
            <div class="jd-form-item"><label>销方税号</label><input value="914403000685593883"></div>
            <div class="jd-form-item"><label>销方名称</label><input value="深圳市德达医疗科技集团有限公司"></div>
            <div class="jd-form-item"><label>开票时间</label><input value="2026-06-26"></div>
            <div class="jd-form-item"><label>发票备注</label><textarea id="invoice-remark"></textarea></div>
            <button onclick="window.pushBuyerClicked = (window.pushBuyerClicked || 0) + 1; window.pushedRemark = document.querySelector('#invoice-remark').value;">推送给买家</button>
          </div>
          <script>
            window.uploadButtonClicked = 0;
            window.pushBuyerClicked = 0;
            window.pushedRemark = '';
          </script>
        </body>
      </html>
    `);

    await 上传发票文件(page, 临时发票路径);

    assert.equal(await page.evaluate(() => window.uploadButtonClicked), 0);
    assert.equal(await page.evaluate(() => window.pushBuyerClicked), 1);
    assert.equal(await page.evaluate(() => window.pushedRemark), '京东');
  } finally {
    fs.rmSync(临时发票路径, { force: true });
    await browser.close();
  }
});

test('京东上传文件会等待发票识别必填字段填完整再推送', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const 临时发票路径 = path.join(os.tmpdir(), `jd-invoice-recognition-${Date.now()}.pdf`);
  fs.writeFileSync(临时发票路径, '%PDF-1.4\n%test\n');
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div role="dialog" aria-label="上传电子发票">
            <input class="jd-upload__input" name="file" accept=".pdf" type="file" style="display:none"
              onchange="setTimeout(() => {
                document.querySelector('#invoice-number').value = '26952000002690108806';
                document.querySelector('#buyer-title').value = '黄婷';
                document.querySelector('#amount').value = '1248.90';
                document.querySelector('#seller-tax').value = '914403000685593883';
                document.querySelector('#seller-name').value = '深圳市德达医疗科技集团有限公司';
                document.querySelector('#invoice-date').value = '2026-06-26';
              }, 200)">
            <div class="jd-form-item"><label>发票号码</label><input id="invoice-number"></div>
            <div class="jd-form-item"><label>发票抬头</label><input id="buyer-title"></div>
            <div class="jd-form-item"><label>发票金额</label><input id="amount"></div>
            <div class="jd-form-item"><label>销方税号</label><input id="seller-tax"></div>
            <div class="jd-form-item"><label>销方名称</label><input id="seller-name"></div>
            <div class="jd-form-item"><label>开票时间</label><input id="invoice-date"></div>
            <button onclick="window.pushBuyerClickedAt = Date.now()">推送给买家</button>
          </div>
          <script>
            window.startedAt = Date.now();
            window.pushBuyerClickedAt = 0;
          </script>
        </body>
      </html>
    `);

    const 进度记录 = [];
    await 上传发票文件(page, 临时发票路径, {
      item: { orderNumber: '3527454014191164' },
      onProgress: async (item, progress) => 进度记录.push(`${progress.stage}:${item.orderNumber}`),
    });

    assert.deepEqual(进度记录, ['wait-recognition:3527454014191164']);
    assert.ok(await page.evaluate(() => window.pushBuyerClickedAt - window.startedAt >= 180));
  } finally {
    fs.rmSync(临时发票路径, { force: true });
    await browser.close();
  }
});

test('京东回传完成不会被无关成功文案误判', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div>极简版标准版切换版本成功</div>
          <div id="drawer">上传电子发票</div>
          <table>
            <tr id="order-row">
              <td>3527454014191164</td>
              <td>待开票</td>
              <td><button>开票</button></td>
            </tr>
          </table>
          <script>
            window.waitStartedAt = Date.now();
            setTimeout(() => {
              document.querySelector('#drawer').remove();
              document.querySelector('#order-row').remove();
              window.orderRemovedAt = Date.now();
            }, 300);
          </script>
        </body>
      </html>
    `);

    await 等待京东回传完成(page, '3527454014191164');

    assert.ok(await page.evaluate(() => window.orderRemovedAt - window.waitStartedAt >= 250));
  } finally {
    await browser.close();
  }
});

test('京东回传完成会把当前订单行开票成功判定为成功', { timeout: 5_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <table>
            <tr>
              <td>3529444003628847</td>
              <td>政府补贴</td>
              <td>催促开票</td>
              <td>电子普票</td>
              <td>￥896.31</td>
              <td>吴佳华</td>
              <td>下单</td>
              <td>开票成功</td>
              <td><a>查看详情</a></td>
            </tr>
          </table>
        </body>
      </html>
    `);

    const 提交状态 = await 读取京东回传提交状态(page, '3529444003628847');
    assert.equal(提交状态.订单已开票成功, true);
    assert.equal(提交状态.订单仍待上传, false);
    await 等待京东回传完成(page, '3529444003628847');
  } finally {
    await browser.close();
  }
});

test('京东回传失败会抛出真实表单校验原因', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <div>上传电子发票</div>
          <div class="jd-form-item__error">请输入开票时间</div>
          <table>
            <tr>
              <td>3527454014191164</td>
              <td>待开票</td>
              <td><button>开票</button></td>
            </tr>
          </table>
        </body>
      </html>
    `);

    await assert.rejects(
      () => 等待京东回传完成(page, '3527454014191164'),
      /请输入开票时间/,
    );
  } finally {
    await browser.close();
  }
});

test('京东回传完成后会重新点击查询按钮刷新列表拿到新结果', { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <button id="query">查询</button>
          <table>
            <tr id="order-row">
              <td>3527454014191164</td>
              <td>待开票</td>
              <td><button>开票</button></td>
            </tr>
          </table>
          <script>
            window.queryClicks = 0;
            document.querySelector('#query').addEventListener('click', () => {
              window.queryClicks += 1;
              document.querySelector('#order-row').innerHTML = '<td>3527454014191164</td><td>开票成功</td>';
            });
          </script>
        </body>
      </html>
    `);

    await 等待京东回传完成(page, '3527454014191164');

    const 点击次数 = await page.evaluate(() => window.queryClicks);
    assert.ok(点击次数 >= 1, `应至少重新点击一次查询按钮，实际 ${点击次数} 次`);
  } finally {
    await browser.close();
  }
});

test('京东回传完成但列表一直无查询按钮时不误伤，按原超时规则处理', { timeout: 15_000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <html>
        <body>
          <table>
            <tr id="order-row">
              <td>3527454014191164</td>
              <td>待开票</td>
              <td><button>开票</button></td>
            </tr>
          </table>
          <script>
            window.orderRemained = true;
          </script>
        </body>
      </html>
    `);

    await assert.rejects(
      () => 等待京东回传完成(page, '3527454014191164', { 超时Ms: 3_000 }),
      /等待京东确认发票回传成功超时/,
    );
  } finally {
    await browser.close();
  }
});
