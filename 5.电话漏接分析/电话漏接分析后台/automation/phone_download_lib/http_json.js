const http = require("http");

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf-8");
      response.on("data", (chunk) => (body += chunk));
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        resolve(JSON.parse(body));
      });
    });
    request.on("error", reject);
    request.setTimeout(3000, () => {
      request.destroy(new Error("请求浏览器调试端口超时"));
    });
  });
}

module.exports = { httpJson };
