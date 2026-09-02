const { 打印日志 } = require('../common/logger');
const {
  禁用常见遮挡浮层,
  获取顶部全部标签点击点,
  获取顶部待开票标签点击点,
} = require('./allInvoiceTab');

const 查询全部申请单接口名 = 'dsm.pop.finance.vendor.spi.cinvoice.ApplyOrderDsmProvider.queryAllApplyOrderList';
const 查询待开票申请单接口名 = 'dsm.pop.finance.vendor.spi.cinvoice.ApplyOrderDsmProvider.queryPendingReviewApplyOrderList';

function 读取接口名称(url) {
  // 解决：京东接口名在 query 参数里，统一解析后再判断。
  try {
    return new URL(url).searchParams.get('api') || '';
  } catch {
    return '';
  }
}

function 是查询全部申请单接口(url) {
  // 解决：只认消费者发票“全部”列表接口，避免误抓其它京东请求。
  return String(url || '').includes('sff.jd.com/api') && 读取接口名称(url) === 查询全部申请单接口名;
}

function 是查询待开票申请单接口(url) {
  // 解决：切换标签重试时只等待待开票列表接口，不误认其它请求。
  return String(url || '').includes('sff.jd.com/api') && 读取接口名称(url) === 查询待开票申请单接口名;
}

function 等待接口响应结果(responsePromise) {
  // 解决：立即接住等待接口的失败结果，避免超时早于后续 await 时变成未处理拒绝。
  return responsePromise
    .then((response) => ({ response, error: null }))
    .catch((error) => ({ response: null, error }));
}

function 确认点击点可用(点击点, 错误前缀) {
  // 解决：统一校验页面定位出的点击坐标，让调用方只处理明确的中文错误。
  if (!点击点?.ok) {
    throw new Error(`${错误前缀}：${点击点?.message || '未找到可点击标签。'}`);
  }
}

async function 点击标签并等待接口(page, 选项) {
  // 解决：先找到点击点，再在真实鼠标点击前启动接口监听，避免把找元素耗时算进接口等待。
  const {
    获取点击点,
    匹配接口,
    timeoutMs,
    成功日志,
    错误前缀,
  } = 选项;

  await 禁用常见遮挡浮层(page);
  const 点击点 = await 获取点击点(page);
  确认点击点可用(点击点, 错误前缀);

  const 等待结果Promise = 等待接口响应结果(page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === 'POST' && 匹配接口(response.url());
  }, { timeout: timeoutMs }));

  await page.mouse.click(点击点.x, 点击点.y);
  打印日志('数据提取', '接口签名', 成功日志(点击点));

  const 等待结果 = await 等待结果Promise;
  if (等待结果.error) {
    throw 等待结果.error;
  }

  return {
    点击点,
    response: 等待结果.response,
  };
}

async function 点击全部并等待接口(page, timeoutMs) {
  // 解决：用真实鼠标切到“全部”并捕获京东页面自己生成的已签名接口。
  const { response } = await 点击标签并等待接口(page, {
    获取点击点: 获取顶部全部标签点击点,
    匹配接口: 是查询全部申请单接口,
    timeoutMs,
    成功日志: (点击点) => `已点击顶部“全部”标签：${点击点.text || '全部'}`,
    错误前缀: '切换全部列表失败',
  });
  const request = response.request();
  const responseText = await response.text();
  const postData = request.postData() || '';
  if (!postData) {
    throw new Error('读取京东催促开票接口失败：已捕获接口请求，但请求体为空。');
  }

  打印日志('数据提取', '接口签名', '已捕获京东页面自己生成的全部列表接口请求');
  return {
    url: request.url(),
    headers: request.headers(),
    postData,
    responseText,
  };
}

async function 切到待开票列表(page) {
  // 解决：当“全部”已是当前标签时，先切走一次才能让京东重新发全部接口。
  await 点击标签并等待接口(page, {
    获取点击点: 获取顶部待开票标签点击点,
    匹配接口: 是查询待开票申请单接口,
    timeoutMs: 10_000,
    成功日志: (点击点) => `已点击顶部“近3个月待开票”标签：${点击点.text || '待开票'}`,
    错误前缀: '切换待开票列表失败',
  }).catch(() => null);
}

async function 捕获查询全部申请单请求(page, 选项 = {}) {
  // 解决：通过页面自己点击生成 h5st 签名请求，必要时先切换标签再重试。
  const { timeoutMs = 30_000, 首次点击超时Ms = 5_000 } = 选项;
  try {
    return await 点击全部并等待接口(page, 首次点击超时Ms);
  } catch (错误) {
    if (!/Timeout/i.test(String(错误?.message || 错误))) {
      throw 错误;
    }
    打印日志('数据提取', '接口签名', '点击“全部”未触发接口，准备先切待开票再切回全部');
  }

  await 切到待开票列表(page);
  return 点击全部并等待接口(page, timeoutMs);
}

module.exports = {
  查询全部申请单接口名,
  查询待开票申请单接口名,
  是查询全部申请单接口,
  是查询待开票申请单接口,
  捕获查询全部申请单请求,
};
