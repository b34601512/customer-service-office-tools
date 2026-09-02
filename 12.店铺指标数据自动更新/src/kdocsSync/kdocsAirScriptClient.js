function parseAirScriptResult(rawResult) {
  if (rawResult && typeof rawResult === "object") {
    return rawResult;
  }
  const resultText = String(rawResult ?? "").trim();
  if (!resultText || resultText === "[Undefined]") {
    throw new Error("AirScript 没有返回写入结果，请确认已粘贴本项目提供的脚本。 ");
  }
  try {
    const parsedResult = JSON.parse(resultText);
    if (!parsedResult || typeof parsedResult !== "object") {
      throw new Error("结果不是对象");
    }
    return parsedResult;
  } catch {
    throw new Error("无法识别 AirScript 返回结果，请确认在线脚本内容完整。 ");
  }
}

function formatRemoteError(remoteError, sensitiveTexts = []) {
  if (!remoteError) return "";
  const errorText = typeof remoteError === "string" ? remoteError : JSON.stringify(remoteError);
  return sensitiveTexts.reduce(
    (safeText, sensitiveText) => String(sensitiveText || "")
      ? safeText.split(String(sensitiveText)).join("[已隐藏]")
      : safeText,
    String(errorText || "")
  ).slice(0, 300);
}

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
    throw new Error(`无法连接金山文档：${String(error?.message || error)}`);
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (!response.ok) {
    let remoteError = "";
    try {
      const errorPayload = JSON.parse(responseText);
      remoteError = formatRemoteError(
        errorPayload?.error || errorPayload?.result || errorPayload?.reason,
        [apiToken]
      );
    } catch {
      remoteError = "";
    }
    throw new Error(
      `金山文档接口返回 HTTP ${response.status}` +
      `${remoteError ? `：${remoteError}` : "，请检查 webhook 和脚本令牌"}。 `
    );
  }
  let responsePayload;
  try {
    responsePayload = JSON.parse(responseText);
  } catch {
    throw new Error("金山文档接口没有返回有效结果。 ");
  }
  const remoteError = formatRemoteError(responsePayload?.error, [apiToken]);
  if (responsePayload?.status !== "finished" || remoteError) {
    throw new Error(`AirScript 执行失败${remoteError ? `：${remoteError}` : "，请在脚本编辑器查看运行日志"}。 `);
  }
  return parseAirScriptResult(responsePayload?.data?.result);
}

module.exports = { parseAirScriptResult, executeKdocsAirScriptSync };
