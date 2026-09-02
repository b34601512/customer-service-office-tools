async function 暂停(page, 毫秒) {
  // 解决：统一兼容真实页面和测试假页面的短暂让步，避免等待逻辑散落在各个文件里。
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(毫秒);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 毫秒));
}

async function 等待直到(page, 检查函数, 选项 = {}) {
  // 解决：把固定等待改成按条件轮询，只要状态就绪就立刻继续，不再拍脑袋睡死几秒。
  const {
    timeoutMs = 10_000,
    intervalMs = 250,
    超时消息 = '等待条件满足超时。',
  } = 选项;
  const 截止时间 = Date.now() + timeoutMs;
  let 最后错误 = null;

  while (Date.now() < 截止时间) {
    try {
      const 检查结果 = await 检查函数();
      if (检查结果) {
        return 检查结果;
      }
    } catch (错误) {
      最后错误 = 错误;
    }

    const 剩余时间 = 截止时间 - Date.now();
    if (剩余时间 <= 0) {
      break;
    }
    await 暂停(page, Math.min(intervalMs, 剩余时间));
  }

  if (最后错误) {
    throw 最后错误;
  }
  throw new Error(超时消息);
}

function 截断单行文本(文本, 最大长度 = 200) {
  // 解决：日志里只保留关键现场，避免整页文本把实时日志刷爆。
  const 单行文本 = String(文本 || '').replace(/\s+/g, ' ').trim();
  if (单行文本.length <= 最大长度) {
    return 单行文本;
  }

  return `${单行文本.slice(0, 最大长度)}...`;
}

async function 读取页面诊断信息(page) {
  // 解决：等待超时时把 URL、标题、加载状态和正文预览一次性打出来，避免只看到 Playwright 超时。
  const 页面地址 = typeof page?.url === 'function' ? page.url() : '';
  const 页面标题 = typeof page?.title === 'function'
    ? await page.title().catch(() => '')
    : '';
  const readyState = typeof page?.evaluate === 'function'
    ? await page.evaluate(() => document.readyState).catch(() => '未知')
    : '未知';
  const 正文文本 = page?.locator
    ? await page.locator('body').innerText().catch(() => '')
    : '';

  return {
    页面地址,
    页面标题,
    readyState,
    正文长度: String(正文文本 || '').replace(/\s+/g, '').length,
    正文预览: 截断单行文本(正文文本),
  };
}

function 格式化页面诊断信息(诊断信息) {
  // 解决：统一把页面现场压缩成单行日志，方便批量巡检时快速判断卡在哪一层。
  return [
    `url=${诊断信息.页面地址 || '空'}`,
    `title=${诊断信息.页面标题 || '空'}`,
    `readyState=${诊断信息.readyState || '未知'}`,
    `textLength=${诊断信息.正文长度}`,
    `textPreview=${诊断信息.正文预览 || '空'}`,
  ].join('｜');
}

module.exports = {
  等待直到,
  读取页面诊断信息,
  格式化页面诊断信息,
};
