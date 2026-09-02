const http = require('http');

const 默认下载中心地址 = 'http://127.0.0.1:39410';

function 发送JSON请求(url, payload) {
  // 这个函数解决其它平台项目无需引入框架即可调用本地下载中心。
  const body = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        const data = text ? JSON.parse(text) : {};
        if (response.statusCode >= 400) {
          const error = new Error(data.message || `下载中心请求失败：HTTP ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.response = data;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function 批量下载发票文件({ baseUrl = 默认下载中心地址, orders = [], orderNumbers = [], force = false } = {}) {
  // 这个函数解决平台项目只关心订单号到发票文件路径的映射，不关心下载中心内部实现。
  const url = new URL('/api/invoices/download', baseUrl);
  const response = await 发送JSON请求(url, { orders, orderNumbers, force });
  return response.files;
}

module.exports = {
  默认下载中心地址,
  发送JSON请求,
  批量下载发票文件,
};
