function readRequestBody(request) {
  // 这里统一读取 POST 请求体，避免控制器里每个接口各自处理流拼接。
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大，请缩小提交内容。"));
      }
    });

    request.on("end", () => {
      resolve(body);
    });

    request.on("error", reject);
  });
}

function parseJsonBody(rawBody) {
  // 这里统一解析 JSON，请求一旦不合法就直接报错，避免静默兜底掩盖问题。
  if (!rawBody) {
    return {};
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${error.message}`);
  }
}

module.exports = {
  readRequestBody,
  parseJsonBody
};
