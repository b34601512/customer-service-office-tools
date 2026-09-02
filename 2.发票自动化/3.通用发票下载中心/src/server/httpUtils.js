function 输出JSON(response, statusCode, payload) {
  // 这个函数解决 HTTP 接口统一返回 JSON 的问题。
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function 读取请求体(request) {
  // 这个函数解决 POST 请求体读取和大小限制的问题。
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('请求体过大。'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function 解析JSON请求体(rawBody) {
  // 这个函数解决非法 JSON 直接暴露错误的问题。
  if (!rawBody) return {};
  return JSON.parse(rawBody);
}

module.exports = {
  输出JSON,
  读取请求体,
  解析JSON请求体,
};
