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

module.exports = {
  等待直到,
};
