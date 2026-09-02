function 规范化浏览器启动地址(启动地址 = '') {
  // 解决：启动地址只允许网页链接，避免错误配置被当成浏览器命令行参数。
  const 标准启动地址 = String(启动地址 || '').trim();
  if (!标准启动地址) {
    return '';
  }
  let 地址对象;
  try {
    地址对象 = new URL(标准启动地址);
  } catch {
    throw new Error('浏览器启动地址必须是 http 或 https 网页链接。');
  }
  if (!['http:', 'https:'].includes(地址对象.protocol)) {
    throw new Error('浏览器启动地址必须是 http 或 https 网页链接。');
  }
  return 地址对象.href;
}

function 构建浏览器启动参数(启动地址 = '') {
  // 解决：浏览器参数只放运行控制项，网页地址统一交给页面导航层处理。
  规范化浏览器启动地址(启动地址);
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disk-cache-size=1048576',
    '--media-cache-size=1048576',
    '--window-size=1440,960',
  ];
}

module.exports = {
  规范化浏览器启动地址,
  构建浏览器启动参数,
};
