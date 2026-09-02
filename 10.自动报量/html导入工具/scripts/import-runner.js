// 该文件用于串联完整导入流程并生成下载文件。
async function runImport() {
  // 该函数用于串联完整导入流程，并把每个关键动作反馈到页面。
  clearResult();
  showImportRunningNotice();
  const runButton = document.getElementById("runButton");
  runButton.disabled = true;
  pageState.importStartedAt = formatDiagnosticTime(new Date());
  setImportStage("导入初始化");
  try {
    const templateFile = document.getElementById("templateFileInput").files[0];
    const csvFile = document.getElementById("csvFileInput").files[0];
    if (!templateFile) throw new Error("请先选择6.4空白报量表。");
    if (!csvFile) throw new Error("请先选择订单商品明细统计.csv。");

    const config = readConfigForm();
    const targetDate = document.getElementById("targetDateInput").value;
    if (!targetDate) throw new Error("请选择导入日期。");
    const targetMonth = Number(targetDate.slice(5, 7));
    if (!config.supportedSheetMonths.includes(targetMonth)) {
      throw new Error(`当前默认映射只支持配置里的月份，不能导入 ${targetDate}。`);
    }

    setImportStage("读取报量模板文件");
    setProgress(3, `正在加载报量表：${templateFile.name}`);
    addStep(`加载报量表：${templateFile.name}`, "done");
    const workbookBuffer = await readFileAsArrayBuffer(templateFile);
    await yieldToUi();

    setImportStage("解压报量模板");
    setProgress(10, "正在解压报量表");
    const zipEntries = await unzipXlsx(workbookBuffer, (percent) => {
      setProgress(10 + percent * 0.18, "正在解压报量表");
    });
    await yieldToUi();

    setImportStage("分析报量模板结构");
    setProgress(28, "正在分析报量表结构");
    const workbookContext = parseWorkbookContext(zipEntries);
    const sheetName = `2026-${targetMonth}`;
    const targetSheet = workbookContext.sheets.find((sheet) => sheet.name.trim() === sheetName);
    if (!targetSheet) throw new Error(`报量表里找不到工作表：${sheetName}`);
    const worksheetDocument = parseXmlFile(zipEntries, targetSheet.path);
    const sharedStrings = readSharedStrings(zipEntries);
    const cellMap = buildCellMap(worksheetDocument);
    const dateColumns = discoverDateColumns(cellMap, config, sharedStrings);
    const targetDates = resolveTargetDates(dateColumns, targetDate, pageState.mode);
    if (targetDates.length === 0) throw new Error(`工作表 ${sheetName} 找不到日期 ${targetDate}。`);
    addStep(`定位工作表：${sheetName}，导入范围：${describeImportRange(targetDate, pageState.mode)}`, "done");
    await yieldToUi();

    setImportStage("读取CSV文件");
    setProgress(36, `正在加载CSV：${csvFile.name}`);
    const csvBuffer = await readFileAsArrayBuffer(csvFile);
    const csvText = decodeCsvText(csvBuffer);
    await yieldToUi();

    setImportStage("解析CSV字段和数据行");
    setProgress(45, "正在解析CSV");
    const csvData = parseCsv(csvText);
    validateRequiredColumns(csvData.headers, config);
    addStep(`CSV解析完成：${csvData.records.length} 行`, "done");
    await yieldToUi();

    setImportStage("过滤订单并汇总数量");
    setProgress(56, "正在过滤订单并按店铺、料号、日期、班次汇总");
    const mappingIndex = buildMappingIndex(config.productRows);
    const aggregation = await aggregateCsvRows(csvData.records, config, mappingIndex, new Set(targetDates), (percent) => {
      setProgress(56 + percent * 0.22, "正在过滤订单并汇总");
    });
    await yieldToUi();

    setImportStage("写入报量模板");
    setProgress(80, "正在写入报量表数值");
    const writeResult = writeAggregationToWorksheet(worksheetDocument, cellMap, sharedStrings, config, dateColumns, targetDates, aggregation);
    zipEntries.set(targetSheet.path, encodeXml(worksheetDocument));
    removeCalculationArtifacts(zipEntries);
    addStep(`写入完成：${formatNumber(writeResult.writtenQuantity)} 件`, "done");
    await yieldToUi();

    setImportStage("重新压缩并打包Excel");
    setProgress(91, "正在重新打包Excel");
    const outputBytes = await buildXlsxZip(zipEntries, (percent) => {
      setProgress(91 + percent * 0.06, "正在压缩并打包Excel");
    });
    await yieldToUi();

    setImportStage("生成下载链接");
    setProgress(97, "正在生成下载文件");
    const outputName = buildOutputFileName(templateFile.name, targetDate, pageState.mode);
    createDownload(outputBytes, outputName);
    updateMetrics(csvData.records.length, aggregation, writeResult);
    renderDetailLog(aggregation, writeResult);
    showImportSuccessNotice(outputName);
    markWorkflowImportSuccess();

    setProgress(100, "导入成功，请点击下方绿色按钮下载报量表");
    addStep(`导出完成：${outputName}`, "done");
  } catch (error) {
    const message = error.message || String(error);
    const diagnosticText = buildImportErrorDiagnostic(error);
    showImportFailureNotice(message);
    markWorkflowImportFailure();
    setProgress(100, "导入失败，请查看处理日志");
    addStep(message, "error");
    appendDetailLog(diagnosticText);
  } finally {
    runButton.disabled = false;
  }
}

function setImportStage(stageText) {
  // 该函数用于记录当前处理阶段，失败时能直接定位卡在流程哪一段。
  pageState.currentImportStage = stageText;
}

function buildImportErrorDiagnostic(error) {
  // 该函数用于生成客服可复制给技术的完整故障诊断信息。
  const templateFile = document.getElementById("templateFileInput").files[0];
  const csvFile = document.getElementById("csvFileInput").files[0];
  const targetDate = document.getElementById("targetDateInput").value || "未选择";
  const message = error?.message || String(error);
  const stack = error?.stack || "无";
  const config = window.REPORT_IMPORT_CONFIG || {};
  const lines = [];
  lines.push("【故障诊断】");
  lines.push("请把下面整段发给技术，不要只截图一句英文报错。");
  lines.push("");
  lines.push("【错误摘要】");
  lines.push(`发生时间：${formatDiagnosticTime(new Date())}`);
  lines.push(`开始时间：${pageState.importStartedAt || "未知"}`);
  lines.push(`处理阶段：${pageState.currentImportStage || "未知"}`);
  lines.push(`进度位置：${pageState.currentProgressPercent}% / ${pageState.currentProgressText || "未知"}`);
  lines.push(`错误名称：${error?.name || "未知"}`);
  lines.push(`错误信息：${message}`);
  lines.push(`原因判断：${explainKnownError(message)}`);
  lines.push("");
  lines.push("【本次选择】");
  lines.push(`导入日期：${targetDate}`);
  lines.push(`导入范围：${targetDate === "未选择" ? "未选择" : describeImportRange(targetDate, pageState.mode)}`);
  lines.push(`导入模式：${pageState.mode}`);
  lines.push(`当前流程节点：${pageState.currentWorkflowStep}`);
  lines.push(`报量模板：${formatFileDiagnostic(templateFile)}`);
  lines.push(`CSV文件：${formatFileDiagnostic(csvFile)}`);
  lines.push("");
  lines.push("【配置摘要】");
  lines.push(`配置版本：${config.version || "未知"}`);
  lines.push(`支持月份：${Array.isArray(config.supportedSheetMonths) ? config.supportedSheetMonths.join(",") : "未知"}`);
  lines.push(`映射行数：${Array.isArray(config.productRows) ? config.productRows.length : "未知"}`);
  lines.push("");
  lines.push("【浏览器环境】");
  lines.push(`页面地址：${location.href}`);
  lines.push(`打开协议：${location.protocol}`);
  lines.push(`浏览器UA：${navigator.userAgent}`);
  lines.push(`语言：${navigator.language || "未知"}`);
  lines.push(`平台：${navigator.platform || "未知"}`);
  lines.push(`CPU线程：${navigator.hardwareConcurrency || "未知"}`);
  lines.push(`设备内存：${navigator.deviceMemory ? `${navigator.deviceMemory}GB` : "未知"}`);
  lines.push(`本地解压能力 DecompressionStream：${typeof DecompressionStream === "undefined" ? "不支持" : "支持"}`);
  lines.push(`本地压缩能力 CompressionStream：${typeof CompressionStream === "undefined" ? "不支持" : "支持"}`);
  lines.push(`CSV中文编码 gb18030：${canUseTextDecoder("gb18030") ? "支持" : "不支持"}`);
  lines.push("");
  lines.push("【原始堆栈】");
  lines.push(stack);
  return lines.join("\n");
}

function explainKnownError(message) {
  // 该函数用于把常见英文底层错误翻译成可排查方向，避免客服看不懂。
  const text = String(message || "");
  if (/failed to fetch/i.test(text)) {
    return "浏览器底层读取本地文件或压缩/解压流失败；优先检查是否用最新版Chrome/Edge、文件是否在本机真实目录、模板/CSV是否被WPS或网盘占用。";
  }
  if (/DecompressionStream|解压/i.test(text)) {
    return "浏览器不支持或无法完成xlsx解压；优先换最新版Chrome/Edge。";
  }
  if (/CompressionStream|压缩|打包/i.test(text)) {
    return "浏览器重新打包Excel失败；优先检查浏览器版本、电脑内存、文件是否过大或被安全软件拦截。";
  }
  if (/network|load failed/i.test(text)) {
    return "浏览器加载本地资源失败；优先确认工具文件夹没有放在压缩包、网盘占位文件或临时目录里。";
  }
  if (/permission|denied|security/i.test(text)) {
    return "浏览器或安全软件权限拦截；优先换本机桌面目录并使用Chrome/Edge。";
  }
  return "未命中常见错误，需要结合处理阶段、文件信息和原始堆栈判断。";
}

function formatFileDiagnostic(file) {
  // 该函数用于输出本地文件的关键元信息，便于判断是否选错文件或文件异常。
  if (!file) return "未选择";
  return `${file.name} / ${formatBytes(file.size)} / 修改时间：${formatDiagnosticTime(new Date(file.lastModified))}`;
}

function formatBytes(size) {
  // 该函数用于把文件字节数转成人能看懂的KB/MB。
  const number = Number(size) || 0;
  if (number >= 1024 * 1024) return `${(number / 1024 / 1024).toFixed(2)}MB`;
  if (number >= 1024) return `${(number / 1024).toFixed(2)}KB`;
  return `${number}B`;
}

function formatDiagnosticTime(date) {
  // 该函数用于统一诊断日志时间格式，方便对照客服截图时间。
  return date.toLocaleString("zh-CN", { hour12: false });
}

function canUseTextDecoder(encoding) {
  // 该函数用于检测当前浏览器是否能识别管易CSV常用中文编码。
  try {
    new TextDecoder(encoding);
    return true;
  } catch (error) {
    return false;
  }
}
