const { sanitizeKdocsDiagnosticText } = require("./kdocsSyncContract");

function parseAirScriptResult(rawResult) {
  if (rawResult && typeof rawResult === "object") {
    return rawResult;
  }
  const resultText = String(rawResult ?? "").trim();
  if (!resultText || resultText === "[Undefined]") {
    throw new Error("AirScript 没有返回执行结果，请确认已粘贴本项目提供的脚本。 ");
  }
  try {
    const parsedResult = JSON.parse(resultText);
    if (!parsedResult || typeof parsedResult !== "object") {
      throw new Error("结果不是对象");
    }
    return parsedResult;
  } catch {
    throw new Error("无法识别 AirScript 执行结果，请确认在线脚本内容完整。 ");
  }
}

function formatRemoteError(remoteError) {
  if (!remoteError) return "";
  const errorText = typeof remoteError === "string" ? remoteError : JSON.stringify(remoteError);
  return sanitizeKdocsDiagnosticText(errorText).slice(0, 300);
}

/*
 * 金山文档官方能力边界（已用线上配置实测）：
 * 1. AirScript-Token 的官方入口是同步 webhook：
 *    POST /api/v3/ide/file/:file_id/script/:script_id/sync_task；
 *    用 Context.argv 传参，并从 data.result 读取已保存脚本的返回值。
 * 2. 已保存的 AirScript 内，Range.Value2 官方支持读写单元格。
 * 3. 官方 KSheet“获取单元格”和“创建并执行临时脚本”接口要求 OAuth access_token，
 *    不能把这里的 AirScript-Token 当作 access_token 使用。
 * 4. 因此，统计日期（"统计日期"表!A3）的真实验收必须由在线共享脚本自行读回并 return，不能把 HTTP 200、
 *    status=finished 或 filterDate 回显当成统计日期已保存；不要退回浏览器 GUI。
 * 5. 当前配置没有 OAuth access_token，AirScript-Token 也不能用于修改在线脚本源码；
 *    若要更新线上脚本，必须先取得官方授权，不要重复摸索或猜测接口。
 * 官方文档：
 * https://open.wps.cn/documents/app-integration-dev/guide/dbsheet/AirScript/script-token/AirScript-apitoken-api
 * https://airsheet.wps.cn/docs/apiV2/excel/workbook/Range/%E5%B1%9E%E6%80%A7/Value2%20%E5%B1%9E%E6%80%A7.html
 * https://developer.kdocs.cn/server/ksheet/workbook-get-cells.html
 * https://developer.kdocs.cn/server/server-script/sync-script.html
 */
async function executeKdocsAirScriptSync({
  webhookUrl,
  apiToken,
  contextArguments,
  requestImplementation = globalThis.fetch,
  timeoutMilliseconds = 120000
}) {
  if (typeof requestImplementation !== "function") {
    throw new Error("当前程序运行环境不支持 HTTPS 请求。 ");
  }
  const requestController = new AbortController();
  const timeoutHandle = setTimeout(() => requestController.abort(), timeoutMilliseconds);
  let response;
  let responseText;
  try {
    response = await requestImplementation(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "AirScript-Token": apiToken
      },
      body: JSON.stringify({ Context: { argv: contextArguments } }),
      signal: requestController.signal
    });
    responseText = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("金山文档同步等待超过2分钟，请稍后重试。 ");
    }
    throw new Error(`无法连接金山文档：${sanitizeKdocsDiagnosticText(error?.message || error)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (!response.ok) {
    throw new Error(`金山文档接口返回 HTTP ${response.status}，请检查 webhook 和脚本令牌。 `);
  }
  let responsePayload;
  try {
    responsePayload = JSON.parse(responseText);
  } catch {
    throw new Error("金山文档接口没有返回有效结果。 ");
  }
  const remoteError = formatRemoteError(responsePayload?.error);
  if (responsePayload?.status !== "finished" || remoteError) {
    throw new Error(`AirScript 执行失败${remoteError ? `：${remoteError}` : "，请在脚本编辑器查看运行日志"}。 `);
  }
  return parseAirScriptResult(responsePayload?.data?.result);
}

module.exports = { parseAirScriptResult, executeKdocsAirScriptSync };
