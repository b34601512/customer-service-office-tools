async function 关闭浏览器进程(browser) {
  // 解决：临时浏览器上下文关闭后必须同时关闭浏览器进程，避免后台残留。
  if (!browser || !browser.isConnected()) {
    return;
  }
  await browser.close();
}

function 绑定浏览器生命周期(context, browser) {
  // 解决：对外仍只操作 context.close，同时确保非持久化 browser 进程一起退出。
  const 原始关闭 = context.close.bind(context);
  let 已关闭 = false;
  context.close = async (...args) => {
    if (已关闭) {
      return;
    }
    已关闭 = true;
    try {
      await 原始关闭(...args);
    } finally {
      await 关闭浏览器进程(browser);
    }
  };
  return context;
}

module.exports = {
  关闭浏览器进程,
  绑定浏览器生命周期,
};
