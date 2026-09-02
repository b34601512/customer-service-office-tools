function writeJson(response, statusCode, payload) {
  // 这里统一输出 JSON 响应，避免接口层重复拷贝响应头逻辑。
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function writeText(response, statusCode, content, contentType = "text/plain; charset=utf-8") {
  // 这里统一输出文本内容，方便 HTML、CSS、JS 和说明文档共用一个收口。
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(content);
}

module.exports = {
  writeJson,
  writeText
};
