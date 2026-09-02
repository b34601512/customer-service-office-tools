function 输出JSON(response, statusCode, payload) {
  // 解决：后台接口统一输出 JSON，前端只处理一种响应格式。
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function 输出文本(response, statusCode, content, contentType = 'text/plain; charset=utf-8') {
  // 解决：静态页面和脚本统一禁用缓存，避免改代码后页面还读旧文件。
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  response.end(content);
}

function 读取请求体(request) {
  // 解决：集中限制请求体大小，避免接口层散落重复代码。
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大，请缩小提交内容。'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function 解析JSON请求体(rawBody) {
  // 解决：非法 JSON 直接报中文错误，避免配置保存失败时无提示。
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch (错误) {
    throw new Error(`请求体不是合法 JSON：${错误.message}`);
  }
}

module.exports = {
  输出JSON,
  输出文本,
  读取请求体,
  解析JSON请求体,
};
