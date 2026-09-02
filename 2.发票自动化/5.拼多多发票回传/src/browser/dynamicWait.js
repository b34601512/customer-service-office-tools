async function 暂停(page, 毫秒) {
  // 解决：等待循环只短暂让出事件，不用固定长时间硬等。
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(毫秒);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 毫秒));
}

async function 等待直到(page, 检查函数, 选项 = {}) {
  // 解决：按真实状态推进流程，避免电脑慢或网络慢时错过页面变化。
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
    await 暂停(page, Math.min(intervalMs, Math.max(0, 截止时间 - Date.now())));
  }

  if (最后错误) {
    throw 最后错误;
  }
  throw new Error(超时消息);
}

module.exports = {
  等待直到,
};
