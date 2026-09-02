const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { 打印日志 } = require('../common/logger');
const { 项目根目录 } = require('../common/paths');

const 下载中心默认地址 = 'http://127.0.0.1:39410';
const 下载中心默认项目目录 = path.resolve(项目根目录, '..', '3.通用发票下载中心');
const 下载中心服务名称 = '通用发票下载中心';

function 读取下载中心地址(选项 = {}) {
  // 解决：下载中心地址只在一个地方决定，方便以后迁移端口或改成环境配置。
  return String(选项.baseUrl || process.env.INVOICE_DOWNLOAD_CENTER_URL || 下载中心默认地址).trim() || 下载中心默认地址;
}

function 读取下载中心项目目录(选项 = {}) {
  // 解决：京东项目只知道公共服务位置，不复制公共服务内部下载代码。
  return path.resolve(String(选项.projectRoot || process.env.INVOICE_DOWNLOAD_CENTER_PROJECT_ROOT || 下载中心默认项目目录));
}

function 构建接口地址(baseUrl, pathname) {
  // 解决：所有下载中心接口路径统一拼接，避免调用方散落字符串。
  return new URL(pathname, baseUrl);
}

function 发送下载中心请求(url, { method = 'POST', payload = {}, timeoutMs = 30_000 } = {}) {
  // 解决：用最小 HTTP 客户端调用本机公共服务，不引入下载中心源码依赖。
  const 请求方法 = String(method || 'POST').toUpperCase();
  const body = 请求方法 === 'GET' ? '' : JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 请求方法,
      headers: body ? {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      } : {},
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (error) {
          reject(new Error(`下载中心返回的不是合法 JSON：${error.message}`));
          return;
        }
        if (response.statusCode >= 400 || data.ok === false) {
          const error = new Error(data.message || `下载中心请求失败：HTTP ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.response = data;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`下载中心请求超时：${url.href}`));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function 读取下载中心健康状态(baseUrl) {
  // 解决：确认端口上运行的是通用发票下载中心，而不是其它本地服务。
  const data = await 发送下载中心请求(构建接口地址(baseUrl, '/api/health'), {
    method: 'GET',
    timeoutMs: 3_000,
  });
  return data?.ok === true && data?.service === 下载中心服务名称;
}

async function 下载中心服务是否可用(baseUrl) {
  // 解决：服务未启动是可恢复状态，交给上层决定是否自动拉起。
  try {
    return await 读取下载中心健康状态(baseUrl);
  } catch {
    return false;
  }
}

function 校验下载中心项目目录(projectRoot) {
  // 解决：自动拉起服务前先确认隔壁项目真实存在，避免启动一个错误路径。
  const serverScriptPath = path.join(projectRoot, 'src', 'server', 'startServer.js');
  if (!fs.existsSync(serverScriptPath)) {
    throw new Error(`下载中心启动失败：没有找到服务入口 ${serverScriptPath}`);
  }
  return serverScriptPath;
}

function 启动下载中心服务(projectRoot) {
  // 解决：回传任务需要发票文件时后台拉起公共下载服务；stdio 忽略加 windowsHide 隐藏窗口，detached 加 unref 保证退出 CLI 不被服务进程阻塞。
  const serverScriptPath = 校验下载中心项目目录(projectRoot);
  const child = spawn(process.execPath, [serverScriptPath], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      INVOICE_DOWNLOAD_CENTER_STARTUP_CLEANED: '1',
      INVOICE_DOWNLOAD_CENTER_OPEN_WINDOW: '0',
    },
    windowsHide: true,
  });
  child.unref();
  打印日志('发票回传', '下载中心', `已拉起通用发票下载中心：PID=${child.pid}`);
  return child.pid;
}

function 等待短间隔(ms) {
  // 解决：状态轮询需要短暂让出事件循环，但成功条件仍然以健康检查为准。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 等待下载中心可用(baseUrl, timeoutMs = 30_000) {
  // 解决：启动下载中心后等待健康检查通过，不用固定等待猜服务状态。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await 下载中心服务是否可用(baseUrl)) return true;
    await 等待短间隔(500);
  }
  throw new Error(`下载中心服务启动超时：${baseUrl}`);
}

async function 确保下载中心可用(选项 = {}) {
  // 解决：回传前统一确认公共下载中心可用，不把服务启动逻辑散落到业务流程。
  const baseUrl = 读取下载中心地址(选项);
  if (await 下载中心服务是否可用(baseUrl)) {
    return baseUrl;
  }
  if (选项.autoStart === false) {
    throw new Error(`下载中心未运行：${baseUrl}`);
  }
  const projectRoot = 读取下载中心项目目录(选项);
  启动下载中心服务(projectRoot);
  await 等待下载中心可用(baseUrl, 选项.startTimeoutMs || 30_000);
  return baseUrl;
}

function 规范化下载中心订单列表(orders) {
  // 解决：只把下载中心需要的订单身份传过去，避免京东上传细节污染公共服务。
  const 订单列表 = (Array.isArray(orders) ? orders : [])
    .map((order) => ({
      key: String(order?.key || '').trim(),
      platform: 'jd',
      storeId: String(order?.storeId || order?.店铺配置?.id || '').trim(),
      storeName: String(order?.storeName || order?.店铺配置?.name || '').trim(),
      orderNumber: String(order?.orderNumber || '').trim(),
    }))
    .filter((order) => order.orderNumber);
  if (!订单列表.length) {
    throw new Error('下载中心下载发票失败：没有可下载的订单。');
  }
  return 订单列表;
}

function 合并下载结果与订单(订单列表, files) {
  // 解决：下载中心按订单号返回文件，本项目继续保留自己的订单 key 用于回写状态。
  const 文件映射 = new Map((Array.isArray(files) ? files : [])
    .map((file) => [String(file?.orderNumber || '').trim(), file]));
  return 订单列表.map((order) => {
    const file = 文件映射.get(order.orderNumber);
    if (!file?.invoiceFilePath) {
      throw new Error(`下载中心没有返回订单 ${order.orderNumber} 的发票文件。`);
    }
    return {
      ...order,
      invoiceFilePath: String(file.invoiceFilePath || '').trim(),
    };
  });
}

async function 批量从下载中心下载发票({ orders, baseUrl, projectRoot, autoStart = true, startTimeoutMs, headless = false } = {}) {
  // 解决：本项目只向公共下载中心提交订单并拿回发票文件；缺少本地文件时让诺诺会话按要求保持复用。
  const 订单列表 = 规范化下载中心订单列表(orders);
  const 服务地址 = await 确保下载中心可用({ baseUrl, projectRoot, autoStart, startTimeoutMs });
  打印日志('发票回传', '下载中心', `请求下载发票：${订单列表.length} 单`);
  const response = await 发送下载中心请求(构建接口地址(服务地址, '/api/invoices/download'), {
    method: 'POST',
    payload: { orders: 订单列表, headless: headless === true },
    timeoutMs: 10 * 60_000,
  });
  return 合并下载结果与订单(订单列表, response.files);
}

async function 关闭下载中心诺诺会话({ baseUrl } = {}) {
  // 解决：JD 控制台退出时只关闭下载中心的诺诺浏览器会话，不强制停止共享 HTTP 服务。
  const 服务地址 = 读取下载中心地址({ baseUrl });
  if (!await 下载中心服务是否可用(服务地址)) return false;
  await 发送下载中心请求(构建接口地址(服务地址, '/api/invoices/session/close'), {
    method: 'POST',
    payload: {},
    timeoutMs: 5_000,
  });
  return true;
}

async function 从下载中心下载发票({ order, orderNumber, baseUrl, projectRoot, autoStart = true, startTimeoutMs, headless = false } = {}) {
  // 解决：单单回传仍走同一公共下载中心，不保留第二套单独下载逻辑。
  const 下载结果 = await 批量从下载中心下载发票({
    orders: [{ ...(order || {}), orderNumber: orderNumber || order?.orderNumber }],
    baseUrl,
    projectRoot,
    autoStart,
    startTimeoutMs,
    headless,
  });
  return 下载结果[0].invoiceFilePath;
}

module.exports = {
  下载中心默认地址,
  下载中心默认项目目录,
  读取下载中心地址,
  读取下载中心项目目录,
  构建接口地址,
  发送下载中心请求,
  读取下载中心健康状态,
  下载中心服务是否可用,
  校验下载中心项目目录,
  启动下载中心服务,
  等待下载中心可用,
  确保下载中心可用,
  规范化下载中心订单列表,
  合并下载结果与订单,
  从下载中心下载发票,
  批量从下载中心下载发票,
  关闭下载中心诺诺会话,
};
