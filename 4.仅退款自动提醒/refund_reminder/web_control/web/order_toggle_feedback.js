(() => {
  function setToggleFeedback(input, stateName) {
    // 该函数把复选框保存状态直接显示在标签上，避免电脑卡顿时误以为没有点中。
    const label = input.closest(".verifying-toggle, .processing-toggle, .handled-toggle");
    if (!label) return;
    if (stateName) label.dataset.state = stateName;
    else delete label.dataset.state;
  }

  function clearToggleFeedbackLater(input, delayMs) {
    // 该函数用于保留短暂反馈后恢复标签常态，避免成功或失败颜色长期停留。
    window.setTimeout(() => setToggleFeedback(input, ""), Number(delayMs) || 2200);
  }

  window.orderToggleFeedback = {
    clearToggleFeedbackLater,
    setToggleFeedback,
  };
})();
