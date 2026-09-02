const 天猫默认业务后台地址 = 'https://myseller.taobao.com/home.htm/QnworkbenchHome/';

function 读取天猫业务后台地址(店铺配置 = {}) {
  // 解决：业务动作优先进入已登录后台，避免每次先撞登录页。
  const targetUrl = String(店铺配置.targetUrl || '').trim();
  if (!targetUrl) return 天猫默认业务后台地址;
  try {
    const url = new URL(targetUrl);
    const redirectUrl = url.searchParams.get('redirect_url');
    if (redirectUrl) return redirectUrl;
    if (url.hostname === 'myseller.taobao.com') return targetUrl;
  } catch {
    return 天猫默认业务后台地址;
  }
  return 天猫默认业务后台地址;
}

module.exports = {
  天猫默认业务后台地址,
  读取天猫业务后台地址,
};
