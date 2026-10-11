(function attachApp() {
  // 解决页面加载后统一绑定交互的问题。
  const extractorApi = window.OrderIdentifierExtractor;
  const tmallXlsxExtractorApi = window.TmallXlsxOrderExtractor;
  const platformInputs = document.querySelectorAll('input[name="platform"]');
  const workspaceGrid = document.querySelector('.workspace-grid');
  const sourceTextInput = document.querySelector('#sourceText');
  const normalResultPanel = document.querySelector('#normalResultPanel');
  const resultTextInput = document.querySelector('#resultText');
  const matchedRefundPanel = document.querySelector('#matchedRefundPanel');
  const matchedOrderPanel = document.querySelector('#matchedOrderPanel');
  const matchedRefundTextInput = document.querySelector('#matchedRefundText');
  const matchedOrderTextInput = document.querySelector('#matchedOrderText');
  const tmallFilePicker = document.querySelector('#tmallFilePicker');
  const tmallFileInput = document.querySelector('#tmallFileInput');
  const pasteButton = document.querySelector('#pasteButton');
  const extractButton = document.querySelector('#extractButton');
  const copyButton = document.querySelector('#copyButton');
  const copyOrderButton = document.querySelector('#copyOrderButton');
  const clearButton = document.querySelector('#clearButton');
  const totalCount = document.querySelector('#totalCount');
  const uniqueCount = document.querySelector('#uniqueCount');
  const duplicateCount = document.querySelector('#duplicateCount');
  const statusPanel = document.querySelector('#statusPanel');
  const copyButtonFeedbackTimerIds = new Map();

  function getNowText() {
    // 解决日志时间格式统一的问题。
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }

  function getCallerFileLine() {
    // 解决浏览器控制台日志需要带文件行号但不手工维护行号的问题。
    const stackLine = new Error().stack?.split('\n')?.[3] || '';
    const match = stackLine.match(/([^/\\]+\.js):(\d+):\d+/);
    return match ? `${match[1]}:${match[2]}` : 'app.js:0';
  }

  function logAction(mainAction, moduleName, subAction) {
    // 解决关键动作需要结构化观察的问题。
    console.info(`[${getNowText()}][${getCallerFileLine()}][主线:${mainAction}][${moduleName}][${subAction}]`);
  }

  function getSelectedPlatformKey() {
    // 解决店铺类型选择状态读取分散的问题。
    const selectedInput = document.querySelector('input[name="platform"]:checked');
    if (!selectedInput) {
      throw new Error('没有选择店铺类型');
    }
    return selectedInput.value;
  }

  function setStatus(message, statusType) {
    // 解决用户操作后必须有可见反馈的问题。
    statusPanel.textContent = message;
    statusPanel.className = `status-panel ${statusType}`;
  }

  function getButtonDefaultText(actionButton) {
    // 解决按钮临时显示反馈后还能稳定恢复原文案的问题。
    if (!actionButton.dataset.defaultText) {
      actionButton.dataset.defaultText = actionButton.textContent;
    }
    return actionButton.dataset.defaultText;
  }

  function resetButtonFeedback(actionButton) {
    // 解决新结果出现后旧复制反馈残留在按钮上的问题。
    const feedbackTimerId = copyButtonFeedbackTimerIds.get(actionButton);
    if (feedbackTimerId) {
      window.clearTimeout(feedbackTimerId);
    }
    copyButtonFeedbackTimerIds.delete(actionButton);
    actionButton.textContent = getButtonDefaultText(actionButton);
    actionButton.classList.remove('feedback-success');
  }

  function resetCopyButtonFeedbacks() {
    // 解决两个复制按钮在切换模式时反馈状态互相污染的问题。
    resetButtonFeedback(copyButton);
    resetButtonFeedback(copyOrderButton);
  }

  function showCopyButtonFeedback(actionButton, feedbackText) {
    // 解决复制完成后的反馈必须出现在被点击按钮上的问题。
    const defaultText = getButtonDefaultText(actionButton);
    const existingFeedbackTimerId = copyButtonFeedbackTimerIds.get(actionButton);
    if (existingFeedbackTimerId) {
      window.clearTimeout(existingFeedbackTimerId);
    }

    actionButton.textContent = feedbackText;
    actionButton.classList.add('feedback-success');
    const nextFeedbackTimerId = window.setTimeout(() => {
      actionButton.textContent = defaultText;
      actionButton.classList.remove('feedback-success');
      copyButtonFeedbackTimerIds.delete(actionButton);
    }, 5000);
    copyButtonFeedbackTimerIds.set(actionButton, nextFeedbackTimerId);
  }

  function removeLeadingCopyMarkerFromLines(rawText) {
    // 解决不同来源会混入不同单引号字符，粘贴到表格后变成可见脏字符的问题。
    return String(rawText || '')
      .split('\n')
      .map((lineText) => lineText.replace(/^[\u0027\u2018\u2019\u201b\u02bc\u2032\uff07]+/, ''))
      .join('\n')
      .trim();
  }

  function updateCounts(nextTotalCount, nextUniqueCount, nextDuplicateCount) {
    // 解决统计数字和提取结果不同步的问题。
    totalCount.textContent = String(nextTotalCount);
    uniqueCount.textContent = String(nextUniqueCount);
    duplicateCount.textContent = String(nextDuplicateCount);
  }

  function updateCopyState() {
    // 解决没有结果时复制按钮仍可点击的问题。
    copyButton.disabled = resultTextInput.value.trim().length === 0;
    copyOrderButton.disabled = matchedOrderTextInput.value.trim().length === 0;
  }

  function clearMatchedColumns() {
    // 解决天猫匹配结果更新前旧列残留导致误复制的问题。
    matchedRefundTextInput.value = '';
    matchedOrderTextInput.value = '';
  }

  function showNormalResultMode() {
    // 解决普通提取和xlsx匹配结果区展示边界混乱的问题。
    resetCopyButtonFeedbacks();
    workspaceGrid.classList.remove('match-mode');
    normalResultPanel.classList.remove('hidden');
    matchedRefundPanel.classList.add('hidden');
    matchedOrderPanel.classList.add('hidden');
    copyButton.classList.remove('hidden');
    copyOrderButton.classList.add('hidden');
    clearMatchedColumns();
    updateCopyState();
  }

  function showMatchedColumnMode() {
    // 解决退款编号和订单编号必须物理分列，方便单独复制订单编号的问题。
    resetCopyButtonFeedbacks();
    workspaceGrid.classList.add('match-mode');
    normalResultPanel.classList.add('hidden');
    matchedRefundPanel.classList.remove('hidden');
    matchedOrderPanel.classList.remove('hidden');
    copyButton.classList.add('hidden');
    copyOrderButton.classList.remove('hidden');
    resultTextInput.value = '';
    updateCopyState();
  }

  function updatePlatformControls() {
    // 解决只有天猫平台才显示xlsx入口的问题。
    const isTmallPlatform = getSelectedPlatformKey() === 'tmall';
    tmallFilePicker.classList.toggle('hidden', !isTmallPlatform);
    tmallFileInput.disabled = !isTmallPlatform;
  }

  function renderExtractionResult(extractionResult) {
    // 解决文本提取和文件提取共用同一套结果渲染的问题。
    showNormalResultMode();
    const resultDisplayLines = extractionResult.displayLines || extractionResult.uniqueIdentifiers;
    resultTextInput.value = resultDisplayLines.join('\n');
    updateCounts(
      extractionResult.matches.length,
      extractionResult.uniqueIdentifiers.length,
      extractionResult.duplicateCount
    );
    updateCopyState();

    if (extractionResult.uniqueIdentifiers.length === 0) {
      setStatus(`未找到${extractionResult.resultName}`, 'warning');
      logAction('提取', 'ExtractorApp', `未找到${extractionResult.resultName}`);
      return;
    }

    setStatus(
      `已提取 ${extractionResult.uniqueIdentifiers.length} 个${extractionResult.resultName}`,
      'success'
    );
    logAction('提取', 'ExtractorApp', `输出${extractionResult.uniqueIdentifiers.length}个${extractionResult.resultName}`);
  }

  function renderMatchedTmallResult(extractionResult) {
    // 解决天猫匹配结果需要退款编号列和订单编号列独立展示的问题。
    showMatchedColumnMode();
    matchedRefundTextInput.value = extractionResult.matchedRows.map((row) => row.refundNumber).join('\n');
    matchedOrderTextInput.value = extractionResult.matchedRows.map((row) => row.orderNumber).join('\n');
    updateCounts(
      extractionResult.matches.length,
      extractionResult.uniqueIdentifiers.length,
      extractionResult.duplicateCount
    );
    updateCopyState();

    if (extractionResult.matchedRows.length === 0) {
      setStatus('xlsx里没有匹配到左侧退款编号', 'warning');
      logAction('提取', 'ExtractorApp', '天猫xlsx匹配0行');
      return;
    }

    logAction('提取', 'ExtractorApp', `输出${extractionResult.matchedRows.length}行天猫匹配结果`);
  }

  function runTextExtraction() {
    // 解决点击提取后从输入文本生成去重结果的问题。
    const platformKey = getSelectedPlatformKey();
    const extractionResult = extractorApi.extractIdentifiers(sourceTextInput.value, platformKey);
    renderExtractionResult(extractionResult);
  }

  async function runExtraction() {
    // 解决天猫选择xlsx后必须从退款编号反查订单编号的问题。
    const platformKey = getSelectedPlatformKey();
    if (platformKey === 'tmall' && tmallFileInput.files?.[0]) {
      await extractFromTmallXlsxFile();
      return;
    }
    runTextExtraction();
  }

  async function extractFromTmallXlsxFile() {
    // 解决天猫平台从左侧退款编号匹配xlsx里的真实订单号的问题。
    const selectedFile = tmallFileInput.files?.[0];
    const refundExtractionResult = extractorApi.extractIdentifiers(sourceTextInput.value, 'tmall');
    if (refundExtractionResult.uniqueIdentifiers.length === 0) {
      showNormalResultMode();
      resultTextInput.value = '';
      updateCounts(0, 0, 0);
      updateCopyState();
      setStatus('左侧未找到退款编号', 'warning');
      logAction('文件', 'ExtractorApp', '左侧未找到退款编号');
      return;
    }

    setStatus('正在读取xlsx文件', 'neutral');
    logAction('文件', 'ExtractorApp', selectedFile ? `读取${selectedFile.name}` : '未选择文件');
    const extractionResult = await tmallXlsxExtractorApi.matchTmallOrderNumbersByRefundNumbersFromXlsxFile(
      selectedFile,
      refundExtractionResult.uniqueIdentifiers
    );
    renderMatchedTmallResult(extractionResult);
    if (extractionResult.matchedRows.length === 0) {
      // 解决全部未命中时渲染层的警告反馈被成功文案覆盖的问题。
      return;
    }
    setStatus(
      `已匹配 ${extractionResult.matchedRefundNumbers.length} 个退款编号，订单号列可单独复制，未命中 ${extractionResult.unmatchedRefundNumbers.length} 个退款编号`,
      'success'
    );
  }

  async function pasteFromClipboard() {
    // 解决用户复制页面内容后快速导入文本的问题。
    const clipboardText = await navigator.clipboard.readText();
    sourceTextInput.value = clipboardText;
    logAction('粘贴', 'ExtractorApp', `导入${clipboardText.length}个字符`);
    await runExtraction();
  }

  async function copyResults() {
    // 解决提取结果需要快速复制到其他系统的问题。
    const resultText = removeLeadingCopyMarkerFromLines(resultTextInput.value);
    if (!resultText) {
      throw new Error('没有可复制的提取结果');
    }
    await navigator.clipboard.writeText(resultText);
    showCopyButtonFeedback(copyButton, '结果已复制');
    logAction('复制', 'ExtractorApp', `复制${resultText.split('\n').length}行结果`);
  }

  async function copyOrderNumbers() {
    // 解决天猫匹配后需要单独复制订单编号列的问题。
    const orderText = removeLeadingCopyMarkerFromLines(matchedOrderTextInput.value);
    if (!orderText) {
      throw new Error('没有可复制的订单编号');
    }
    await navigator.clipboard.writeText(orderText);
    showCopyButtonFeedback(copyOrderButton, '订单已复制');
    logAction('复制', 'ExtractorApp', `复制${orderText.split('\n').length}行订单编号`);
  }

  function clearAll() {
    // 解决重新处理下一批文本前旧数据残留的问题。
    showNormalResultMode();
    sourceTextInput.value = '';
    resultTextInput.value = '';
    tmallFileInput.value = '';
    updateCounts(0, 0, 0);
    updateCopyState();
    setStatus('已清空', 'neutral');
    logAction('清空', 'ExtractorApp', '清理输入和结果');
  }

  function handleAsyncAction(actionPromiseFactory) {
    // 解决异步错误必须暴露给用户且不能静默吞掉的问题。
    actionPromiseFactory().catch((error) => {
      setStatus(error.message, 'error');
      logAction('错误', 'ExtractorApp', error.message);
      throw error;
    });
  }

  extractButton.addEventListener('click', () => handleAsyncAction(runExtraction));
  pasteButton.addEventListener('click', () => handleAsyncAction(pasteFromClipboard));
  copyButton.addEventListener('click', () => handleAsyncAction(copyResults));
  copyOrderButton.addEventListener('click', () => handleAsyncAction(copyOrderNumbers));
  clearButton.addEventListener('click', clearAll);
  tmallFileInput.addEventListener('change', () => handleAsyncAction(extractFromTmallXlsxFile));
  sourceTextInput.addEventListener('input', () => {
    if (getSelectedPlatformKey() === 'tmall' && tmallFileInput.files?.[0]) {
      clearMatchedColumns();
      updateCopyState();
      setStatus('退款编号已更新，点击提取重新匹配xlsx', 'neutral');
      return;
    }
    runTextExtraction();
  });
  platformInputs.forEach((platformInput) => {
    platformInput.addEventListener('change', () => {
      updatePlatformControls();
      handleAsyncAction(runExtraction);
    });
  });

  updatePlatformControls();
  updateCopyState();
  logAction('启动', 'ExtractorApp', '页面初始化完成');
})();
