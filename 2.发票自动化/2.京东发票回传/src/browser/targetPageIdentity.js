const 目标页面地址 = 'https://shop.jd.com/jdm/finance/consumerInvoice/cinvoiceOrder';
const 登录认证地址关键词 = ['login', 'passport', 'auth', 'oauth'];

function 解码路径(路径) {
  // 解决：京东有时会编码路径，比较前先统一成可读路径。
  try {
    return decodeURIComponent(String(路径 || ''));
  } catch {
    return String(路径 || '');
  }
}

function 规范化业务路径(路径) {
  // 解决：路径末尾斜杠不代表不同业务页面，比较时统一去掉。
  return 解码路径(路径).replace(/\/+$/g, '');
}

function 提取目标业务路径(目标地址 = 目标页面地址) {
  // 解决：登录页 redirect_url 可能只携带业务路径，所以统一抽出稳定路径片段判断。
  try {
    return 规范化业务路径(new URL(目标地址).pathname);
  } catch {
    return '';
  }
}

function 解码完整地址两次(url) {
  // 解决：京东登录跳转地址经常被编码一到两层，必须逐层解开后再判断目标业务路径。
  const 地址列表 = [String(url || '')];
  let 当前地址 = 地址列表[0];
  for (let index = 0; index < 2; index += 1) {
    try {
      const 解码后地址 = decodeURIComponent(当前地址);
      if (解码后地址 === 当前地址) {
        break;
      }
      地址列表.push(解码后地址);
      当前地址 = 解码后地址;
    } catch {
      break;
    }
  }
  return 地址列表;
}

function 是登录认证地址(url) {
  // 解决：登录、认证、OAuth 中转页都可能携带目标页 redirect_url，不能当成无关页签。
  try {
    const 地址对象 = new URL(url);
    const 地址身份文本 = `${地址对象.hostname}${地址对象.pathname}`.toLowerCase();
    return 登录认证地址关键词.some((关键词) => 地址身份文本.includes(关键词));
  } catch {
    return false;
  }
}

function 是目标地址页面(url, 目标地址 = 目标页面地址) {
  // 解决：页面身份先看域名和路径，禁止只靠页面文案猜当前业务页。
  try {
    const 当前地址对象 = new URL(url);
    const 目标地址对象 = new URL(目标地址);
    return (
      当前地址对象.hostname === 目标地址对象.hostname
      && 规范化业务路径(当前地址对象.pathname) === 规范化业务路径(目标地址对象.pathname)
    );
  } catch {
    return false;
  }
}

function 是目标地址或登录跳转页面(url, 目标地址 = 目标页面地址) {
  // 解决：已打开的登录页如果 redirect_url 指向目标页，本质上就是目标页流程，必须复用等待。
  if (是目标地址页面(url, 目标地址)) {
    return true;
  }

  if (!是登录认证地址(url)) {
    return false;
  }

  const 目标业务路径 = 提取目标业务路径(目标地址);
  if (!目标业务路径) {
    return false;
  }

  return 解码完整地址两次(url).some((地址文本) => 规范化业务路径(地址文本).includes(目标业务路径));
}

module.exports = {
  目标页面地址,
  是目标地址页面,
  是目标地址或登录跳转页面,
};
