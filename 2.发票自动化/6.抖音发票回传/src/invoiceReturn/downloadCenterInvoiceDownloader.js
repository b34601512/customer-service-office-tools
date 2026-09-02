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
  // 解决：下载中心地址集中配置，抖音项目只依赖 HTTP 契约。
  return String(选项.baseUrl || process.env.INVOICE_DOWNLOAD_CENTER_URL || 下载中心默认地址).trim() || 下载中心默认地址;
}

function 读取下载中心项目目录(选项 = {}) {
  // 解决：自动拉起下载中心时只知道隔壁项目目录，不复制下载实现。
  return path.resolve(String(选项.projectRoot || process.env.INVOICE_DOWNLOAD_CENTER_PROJECT_ROOT || 下载中心默认项目目录));
}

function 构建接口地址(baseUrl, pathname) {
  // 解决：下载中心接口路径统一拼接，避免业务层散落字符串。
  return new URL(pathname, baseUrl);
}

function 发送下载中心请求(url, { method = 'POST', payload = {}, timeoutMs = 30_000 } = {}) {
  // 解决：用最小 HTTP 客户端调用本机下载中心，不引入下载中心源码依赖。
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
        } catch (错误) {
          reject(new Error(`下载中心返回的不是合法 JSON：${错误.message}`));
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
  // 解决：端口可访问不等于服务正确，必须确认是通用发票下载中心。
  const data = await 发送下载中心请求(构建接口地址(baseUrl, '/api/health'), {
    method: 'GET',
    timeoutMs: 3_000,
  });
  return data?.ok === true && data?.service === 下载中心服务名称;
}

async function 下载中心服务是否可用(baseUrl) {
  // 解决：健康检查失败只表示服务不可用，上层决定是否自动启动。
  try {
    return await 读取下载中心健康状态(baseUrl);
  } catch {
    return false;
  }
}

function 校验下载中心项目目录(projectRoot) {
  // 解决：启动前先确认服务入口存在，避免在错误目录拉起 Node。
  const serverScriptPath = path.join(projectRoot, 'src', 'server', 'startServer.js');
  if (!fs.existsSync(serverScriptPath)) {
    throw new Error(`下载中心启动失败：没有找到服务入口 ${serverScriptPath}`);
  }
  return serverScriptPath;
}

function 启动下载中心服务(projectRoot) {
  // 解决：抖音回传只负责拉起公共服务，不复制公共服务内部逻辑。
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
  打印日志('抖音发票回传', '下载中心', `已拉起通用发票下载中心：PID=${child.pid}`);
  return child.pid;
}

function 等待短间隔(ms) {
  // 解决：轮询健康状态时让出事件循环，成功条件仍以真实状态为准。
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function 等待下载中心可用(baseUrl, timeoutMs = 30_000) {
  // 解决：启动后等健康检查通过，不用固定等待猜服务是否就绪。
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await 下载中心服务是否可用(baseUrl)) return true;
    await 等待短间隔(500);
  }
  throw new Error(`下载中心服务启动超时：${baseUrl}`);
}

async function 确保下载中心可用(选项 = {}) {
  // 解决：回传前统一确认下载中心可用，业务流程不用关心启动细节。
  const baseUrl = 读取下载中心地址(选项);
  if (await 下载中心服务是否可用(baseUrl)) return baseUrl;
  if (选项.autoStart === false) {
    throw new Error(`下载中心未运行：${baseUrl}`);
  }
  const projectRoot = 读取下载中心项目目录(选项);
  启动下载中心服务(projectRoot);
  await 等待下载中心可用(baseUrl, 选项.startTimeoutMs || 30_000);
  return baseUrl;
}

function 规范化下载中心订单列表(orders) {
  // 解决：只把下载中心需要的订单身份传过去，不把抖音上传细节带入公共服务。
  const 订单列表 = (Array.isArray(orders) ? orders : [])
    .map((order) => ({
      key: String(order?.key || order?.orderNumber || '').trim(),
      platform: 'douyin',
      storeId: String(order?.storeId || order?.店铺配置?.id || '').trim(),
      storeName: String(order?.storeName || order?.店铺配置?.name || '').trim(),
      orderNumber: String(order?.orderNumber || '').trim(),
    }))
    .filter((order) => order.orderNumber);
  if (!订单列表.length) {
    throw new Error('下载中心下载发票失败：没有可下载的抖音订单。');
  }
  return 订单列表;
}

function 合并下载结果与订单(订单列表, files) {
  // 解决：下载中心按订单号返回文件和发票号码，抖音流程继续保留自己的订单身份。
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
      invoiceNumber: String(file.invoiceNumber || '').trim(),
      invoiceCode: String(file.invoiceCode || '').trim(),
      invoiceSubjectName: String(file.invoiceSubjectName || '').trim(),
      invoiceSubjectTaxNum: String(file.invoiceSubjectTaxNum || '').trim(),
    };
  });
}

async function 批量从下载中心下载发票({ orders, baseUrl, projectRoot, autoStart = true, startTimeoutMs, requestTimeoutMs = 3 * 60_000 } = {}) {
  // 解决：抖音项目只提交订单号并拿回发票路径，下载实现完全交给公共下载中心。
  const 订单列表 = 规范化下载中心订单列表(orders);
  const 服务地址 = await 确保下载中心可用({ baseUrl, projectRoot, autoStart, startTimeoutMs });
  打印日志('抖音发票回传', '下载中心', `请求下载发票：${订单列表.length} 单`);
  const response = await 发送下载中心请求(构建接口地址(服务地址, '/api/invoices/download'), {
    method: 'POST',
    payload: { orders: 订单列表 },
    timeoutMs: requestTimeoutMs,
  });
  return 合并下载结果与订单(订单列表, response.files);
}

module.exports = {
  下载中心默认地址,
  下载中心默认项目目录,
  读取下载中心地址,
  读取下载中心项目目录,
  构建接口地址,
  发送下载中心请求,
  下载中心服务是否可用,
  确保下载中心可用,
  规范化下载中心订单列表,
  合并下载结果与订单,
  批量从下载中心下载发票,
};
