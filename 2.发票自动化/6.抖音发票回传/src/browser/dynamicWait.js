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

async function 限时等待(承诺, 选项 = {}) {
  // 解决（2026-09-20 静默卡死实锤）：Playwright 的 evaluate/evaluateAll/keyboard 等调用在渲染进程无响应时
  // 永远不会返回；写在循环条件里的超时判断也救不了“循环体本身卡住”（既没输出也没报错）。
  // 这类调用一律用墙钟上限兜住，超时就抛错留现场。
  const { 超时毫秒 = 15_000, 说明 = '受限调用' } = 选项;
  let 计时器 = null;
  const 超时承诺 = new Promise((_, reject) => {
    计时器 = setTimeout(
      () => reject(new Error(`${说明}超过墙钟上限 ${超时毫秒} 毫秒仍未返回，按卡死处理。`)),
      超时毫秒,
    );
    if (typeof 计时器.unref === 'function') 计时器.unref();
  });
  try {
    return await Promise.race([Promise.resolve(承诺), 超时承诺]);
  } finally {
    if (计时器) clearTimeout(计时器);
  }
}

module.exports = {
  等待直到,
  限时等待,
};
