// 共享下载中心入口：各平台首页都通过这里打开同一个下载中心 TUI，不复制下载中心业务代码。
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const 总目录 = path.resolve(__dirname, '..');
const 下载中心目录 = path.join(总目录, '3.通用发票下载中心');
const 下载中心启动文件 = path.join(下载中心目录, '启动下载中心.bat');
const 下载中心默认地址 = 'http://127.0.0.1:39410';
const 诺诺登录状态文件路径 = path.join(下载中心目录, 'runtime', 'nuonuo-login-status.json');

function 构建Windows命令参数(参数) {
  return `"${String(参数 || '').replace(/"/g, '""')}"`;
}

function 检查下载中心入口({ fileExists = fs.existsSync } = {}) {
  if (!fileExists(下载中心目录)) {
    throw new Error(`没有找到通用发票下载中心目录：${下载中心目录}`);
  }
  if (!fileExists(下载中心启动文件)) {
    throw new Error(`没有找到下载中心启动文件：${下载中心启动文件}`);
  }
  return { 项目目录路径: 下载中心目录, 启动文件路径: 下载中心启动文件 };
}

function 构建下载中心窗口命令({ 项目目录路径 = 下载中心目录, 启动文件路径 = 下载中心启动文件 } = {}) {
  return [
    'start',
    构建Windows命令参数('发票自动化-通用发票下载中心'),
    '/max',
    '/d',
    构建Windows命令参数(项目目录路径),
    'cmd.exe',
    '/d',
    '/c',
    'call',
    构建Windows命令参数(启动文件路径),
    '--launcher-maximized',
  ].join(' ');
}

function 启动下载中心窗口({
  fileExists = fs.existsSync,
  launchWindow,
} = {}) {
  const 入口 = 检查下载中心入口({ fileExists });
  const 启动函数 = launchWindow || ((命令) => spawn('cmd.exe', ['/d', '/s', '/c', 命令], {
    cwd: 总目录,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    windowsVerbatimArguments: true,
  }));
  const 子进程 = 启动函数(构建下载中心窗口命令(入口));
  子进程?.unref?.();
  return 入口;
}

function 发送下载中心GET(路径名称, timeoutMs = 3000) {
  // 解决：各平台首页只读健康/登录状态，不需要复制下载中心的 HTTP 契约。
  const baseUrl = process.env.INVOICE_DOWNLOAD_CENTER_URL || 下载中心默认地址;
  const url = new URL(路径名称, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (错误) {
          reject(new Error(`下载中心返回的不是合法 JSON：${错误.message}`));
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`下载中心请求超时：${url.href}`));
    });
    request.on('error', reject);
  });
}

function 读取持久化诺诺登录状态() {
  try {
    if (!fs.existsSync(诺诺登录状态文件路径)) return null;
    const 数据 = JSON.parse(fs.readFileSync(诺诺登录状态文件路径, 'utf8'));
    return 数据 && typeof 数据 === 'object' ? 数据 : null;
  } catch {
    return null;
  }
}

function 判断诺诺登录就绪(状态对象) {
  // 解决：各平台首页和快捷排序统一按“诺诺登录”这一项决定是否把下载中心顶到第一位。
  if (!状态对象) return false;
  const 条目列表 = Array.isArray(状态对象.items) && 状态对象.items.length > 0
    ? 状态对象.items
    : [状态对象];
  const 诺诺条目 = 条目列表.find((条目) => String(条目.name || '').includes('诺诺登录'))
    || 条目列表.find((条目) => String(条目.name || '').includes('发票下载'))
    || 条目列表[0];
  return Boolean(诺诺条目 && 诺诺条目.status === 'ready');
}

function 合并本地诺诺登录状态(登录状态, 本地状态文件) {
  if (!登录状态) return 本地状态文件 || null;
  const 标准登录状态 = {
    ...登录状态,
    detail: String(登录状态.detail || ''),
  };
  if (登录状态.status === 'ready' || 本地状态文件?.status !== 'ready') {
    return 标准登录状态;
  }
  // 服务在线但登录状态接口尚未同步时，直接采用刚写入的本地状态文件，避免平台首页一直显示“未检查”。
  return {
    status: 本地状态文件.status,
    label: String(本地状态文件.label || '可用'),
    detail: `${本地状态文件.detail || '状态文件显示可用'}（本地状态直读）`,
  };
}


async function 读取下载中心外部服务状态({ 发送GET = 发送下载中心GET, 读取本地状态 = 读取持久化诺诺登录状态 } = {}) {
  // 解决：把“服务在线”和“诺诺登录有效”拆开，供首页分级显示和快捷操作动态排序。
  const 地址 = process.env.INVOICE_DOWNLOAD_CENTER_URL || 下载中心默认地址;
  let 服务可用 = false;
  try {
    const 健康数据 = await 发送GET('/api/health');
    服务可用 = 健康数据?.ok === true && 健康数据?.service === '通用发票下载中心';
  } catch {
    服务可用 = false;
  }
  if (!服务可用) {
    return {
      status: 'error',
      label: '不可用',
      detail: '下载中心服务未运行或健康检查失败',
      items: [
        { name: '下载服务', status: 'error', label: '离线', detail: '服务未运行或健康检查失败' },
        { name: '诺诺登录', status: 'error', label: '无法检查', detail: '下载中心未连接' },
        { name: '发票下载', status: 'error', label: '不可用', detail: '请先启动下载中心' },
      ],
    };
  }
  let 登录状态 = null;
  try {
    const data = await 发送GET('/api/login/status');
    登录状态 = {
      status: String(data?.status || 'unknown'),
      label: String(data?.label || '未检查'),
      detail: String(data?.detail || ''),
    };
  } catch {
    // 兼容升级前仍在运行的旧下载中心进程：接口不存在时直接读共享状态文件。
    登录状态 = 读取本地状态() || {
      status: 'unknown',
      label: '未检查',
      detail: '登录状态接口不可用',
    };
  }
  const 本地状态文件 = 读取本地状态();
  登录状态 = 合并本地诺诺登录状态(登录状态, 本地状态文件);
  if (登录状态.status !== 'ready') {
    // 解决：首页显示非可用时先做一次无头真实验证（已登录则立即恢复“可用”），
    // 避免用户明明在浏览器登录了诺诺，首页还一直停留在旧的失败快照。
    try {
      const 探测结果 = await 发送GET('/api/login/probe', 8_000);
      if (探测结果?.ok === true) {
        登录状态 = {
          status: 'ready',
          label: '可用',
          detail: `主体 ${Number(探测结果.invoiceSubjectCount || 0)} 个`,
        };
      }
    } catch {
      // 旧版下载中心没有探测接口时保持原快照，不阻断首页刷新。
    }
  }
  const 登录就绪 = 登录状态.status === 'ready';
  return {
    status: 登录就绪 ? 'ready' : 'error',
    label: 登录就绪 ? '可用' : '不可用',
    detail: 地址,
    items: [
      { name: '下载服务', status: 'ready', label: '在线', detail: 地址 },
      {
        name: '诺诺登录',
        status: 登录状态.status === 'unknown' ? 'checking' : 登录状态.status,
        label: 登录状态.status === 'ready' ? '可用' : (登录状态.status === 'unknown' ? '未检查' : 登录状态.label || '失效'),
        detail: 登录状态.detail || '',
      },
      {
        name: '发票下载',
        status: 登录就绪 ? 'ready' : (登录状态.status === 'unknown' ? 'checking' : 'error'),
        label: 登录就绪 ? '可用' : (登录状态.status === 'unknown' ? '未检查' : '不可用'),
        detail: 登录就绪 ? '可以开始回传' : (登录状态.detail || '请先检查诺诺登录'),
      },
    ],
  };
}

function 启动下载中心服务({
  fileExists = fs.existsSync,
  launchProcess,
} = {}) {
  // 服务进程保持后台运行且不额外占用一个黑窗；重复启动时 startServer 会自行识别已运行并退出。
  const 入口 = 检查下载中心入口({ fileExists });
  const 服务入口文件 = path.join(入口.项目目录路径, 'src', 'server', 'startServer.js');
  if (!fileExists(服务入口文件)) {
    throw new Error(`没有找到下载中心服务入口：${服务入口文件}`);
  }
  const 启动函数 = launchProcess || ((命令, 参数, 选项) => spawn(命令, 参数, 选项));
  const 子进程 = 启动函数(
    process.execPath,
    [服务入口文件],
    {
      cwd: 入口.项目目录路径,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );
  子进程?.unref?.();
  return 服务入口文件;
}

module.exports = {
  总目录,
  下载中心目录,
  下载中心启动文件,
  下载中心默认地址,
  检查下载中心入口,
  构建下载中心窗口命令,
  启动下载中心窗口,
  启动下载中心服务,
  读取下载中心外部服务状态,
  合并本地诺诺登录状态,
  判断诺诺登录就绪,
};
