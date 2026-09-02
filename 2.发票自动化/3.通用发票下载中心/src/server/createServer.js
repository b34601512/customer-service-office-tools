const http = require('http');
const fs = require('fs');
const { 读取发票系统配置, 保存发票系统配置, 构建安全发票系统配置视图 } = require('../config/invoiceSystemConfig');
const { 导入旧京东发票系统配置 } = require('../config/legacyJdConfigImporter');
const { 验证诺诺登录, 写入诺诺登录状态, 无头探测诺诺登录 } = require('../nuonuo/loginVerifier');
const { 关闭共享诺诺浏览器会话 } = require('../nuonuo/nuonuoBrowserSession');
const { 批量下载发票 } = require('../nuonuo/invoiceDownloader');
const { 查找本地发票, 列出本地发票, 登记本地发票文件 } = require('../invoices/invoiceFileStore');
const { 输出JSON, 读取请求体, 解析JSON请求体 } = require('./httpUtils');
const { 获取下载文件夹路径, 打开下载文件夹 } = require('./downloadsFolder');
const { 项目根目录, 登录态文件路径 } = require('../common/paths');
const { 打印日志 } = require('../common/logger');

const 服务名称 = '通用发票下载中心';

function 读取持久化诺诺登录状态() {
  try {
    if (!fs.existsSync(require('../common/paths').诺诺登录状态文件路径)) return null;
    const 数据 = JSON.parse(fs.readFileSync(require('../common/paths').诺诺登录状态文件路径, 'utf8'));
    return 数据 && typeof 数据 === 'object' ? 数据 : null;
  } catch {
    return null;
  }
}

function createServer(options = {}) {
  // 这个函数解决对其它平台项目提供统一本地 HTTP API 的问题。
  const {
    requestShutdown = async () => {},
    serviceStartedAt = new Date().toISOString(),
    readInvoiceSystemConfig = 读取发票系统配置,
    saveInvoiceSystemConfig = 保存发票系统配置,
    probeNuonuoLogin = 无头探测诺诺登录,
    probeCooldownMs = 60_000,
  } = options;
  let 诺诺登录状态 = 读取持久化诺诺登录状态() || (fs.existsSync(登录态文件路径)
    ? { status: 'unknown', label: '未检查', detail: '尚未完成真实登录校验' }
    : { status: 'error', label: '失效', detail: '未发现诺诺登录态文件' });

  const 更新诺诺登录状态 = (status, label, detail = '') => {
    诺诺登录状态 = { status, label, detail, updatedAt: new Date().toISOString() };
    // 落盘统一走 loginVerifier 的单一实现（issue #584），写入失败不阻断下载服务。
    写入诺诺登录状态(status, label, detail);
  };

  let 上次探测时间 = 0;
  let 探测中 = false;

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');

      if (request.method === 'GET' && url.pathname === '/api/health') {
        输出JSON(response, 200, { ok: true, service: 服务名称 });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/login/status') {
        诺诺登录状态 = 读取持久化诺诺登录状态() || 诺诺登录状态;
        输出JSON(response, 200, {
          ok: true,
          service: 服务名称,
          ...诺诺登录状态,
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/login/probe') {
        const 现在 = Date.now();
        if (探测中) {
          输出JSON(response, 200, { ok: false, busy: true, message: '正在探测诺诺登录态，请稍候。' });
          return;
        }
        if (现在 - 上次探测时间 < probeCooldownMs) {
          输出JSON(response, 200, { ok: false, throttled: true, message: '近期已探测过，沿用当前登录状态。' });
          return;
        }
        上次探测时间 = 现在;
        探测中 = true;
        try {
          // 解决：无头探测只认真实发票接口；成功后首页即使没有手动检查也能恢复“可用”。
          const result = await probeNuonuoLogin(readInvoiceSystemConfig(), { timeoutMs: 15_000 });
          if (result.ok) {
            更新诺诺登录状态('ready', '可用', `主体 ${result.invoiceSubjectCount || 0} 个`);
          }
          输出JSON(response, 200, {
            ok: result.ok === true,
            invoiceSubjectCount: result.invoiceSubjectCount || 0,
            message: String(result.message || ''),
          });
        } catch (error) {
          输出JSON(response, 200, { ok: false, message: String(error?.message || error || '探测失败') });
        } finally {
          探测中 = false;
        }
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/service/status') {
        输出JSON(response, 200, {
          ok: true,
          service: 服务名称,
          pid: process.pid,
          projectRoot: 项目根目录,
          downloadsDirectory: 获取下载文件夹路径(),
          startedAt: serviceStartedAt,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/service/shutdown') {
        输出JSON(response, 200, { ok: true, message: '后台正在退出。' });
        setTimeout(() => {
          Promise.resolve(requestShutdown('接口请求退出下载中心')).catch((error) => {
            打印日志('后台退出', '退出失败', error.message);
          });
        }, 100);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/config') {
        const config = readInvoiceSystemConfig();
        输出JSON(response, 200, { ok: true, config: 构建安全发票系统配置视图(config) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/config') {
        const body = 解析JSON请求体(await 读取请求体(request));
        const config = saveInvoiceSystemConfig({ ...readInvoiceSystemConfig(), ...body });
        输出JSON(response, 200, { ok: true, config: 构建安全发票系统配置视图(config) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/config/search-range') {
        const body = 解析JSON请求体(await 读取请求体(request));
        const config = saveInvoiceSystemConfig({
          ...readInvoiceSystemConfig(),
          invoiceSearchRangeDays: body.invoiceSearchRangeDays,
        });
        输出JSON(response, 200, { ok: true, config: 构建安全发票系统配置视图(config) });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/config/import-jd') {
        输出JSON(response, 200, {
          ok: true,
          result: 导入旧京东发票系统配置(),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/login/check') {
        const result = await 验证诺诺登录(readInvoiceSystemConfig(), {
          headless: false,
          keepBrowserOpenOnManualLogin: true,
          keepBrowserOpenOnSuccess: true,
        });
        if (result.ok) {
          更新诺诺登录状态('ready', '可用', `主体 ${result.invoiceSubjectCount || 0} 个`);
        } else {
          更新诺诺登录状态('error', '失效', result.message || '登录检查失败');
        }
        输出JSON(response, result.ok ? 200 : 409, result);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/invoices/local') {
        const orderNumber = String(url.searchParams.get('orderNumber') || '').trim();
        输出JSON(response, 200, {
          ok: true,
          invoice: orderNumber ? 查找本地发票(orderNumber) : null,
          invoices: orderNumber ? undefined : 列出本地发票(),
        });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/downloads/path') {
        输出JSON(response, 200, { ok: true, downloadsDirectory: 获取下载文件夹路径() });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/downloads/open') {
        输出JSON(response, 200, { ok: true, downloadsDirectory: await 打开下载文件夹() });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/invoices/local') {
        const body = 解析JSON请求体(await 读取请求体(request));
        输出JSON(response, 200, {
          ok: true,
          invoice: 登记本地发票文件(body),
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/invoices/download') {
        const body = 解析JSON请求体(await 读取请求体(request));
        const invoiceSystemConfig = readInvoiceSystemConfig();
        try {
          const files = await 批量下载发票(body, {
            force: body.force === true,
            fileType: body.fileType || 'pdf',
            headless: body.headless !== false,
            invoiceSystemConfig,
            invoiceSearchRangeDays: invoiceSystemConfig.invoiceSearchRangeDays,
          });
          更新诺诺登录状态('ready', '可用', '最近一次下载校验通过');
          输出JSON(response, 200, { ok: true, files });
        } catch (error) {
          if (/诺诺登录态|登录态不存在|登录态已失效|登录失败/i.test(String(error?.message || ''))) {
            更新诺诺登录状态('error', '失效', String(error.message));
          }
          throw error;
        }
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/invoices/session/close') {
        await 关闭共享诺诺浏览器会话();
        输出JSON(response, 200, { ok: true, message: '诺诺下载会话已关闭。' });
        return;
      }

      输出JSON(response, 404, { ok: false, message: '接口不存在。' });
    } catch (error) {
      输出JSON(response, error.statusCode || 500, {
        ok: false,
        code: error.code,
        message: error.message,
        missingOrders: error.missingOrders,
        localFiles: error.localFiles,
      });
    }
  });
}

module.exports = {
  createServer,
};
