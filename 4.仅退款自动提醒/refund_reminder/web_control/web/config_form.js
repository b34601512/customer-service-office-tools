(() => {
  const fields = [
    { key: "erp_url", label: "ERP 地址" },
    { key: "interval_minutes", label: "查询间隔分钟", type: "number", min: 5 },
    { key: "browser_start_timeout_sec", label: "浏览器启动等待秒", type: "number", min: 10 },
    { key: "page_load_timeout_sec", label: "页面加载等待秒", type: "number", min: 10 },
    { key: "login_wait_timeout_sec", label: "登录等待秒", type: "number", min: 1 },
    { key: "order_page_wait_timeout_sec", label: "订单页等待秒", type: "number", min: 1 },
    { key: "poll_interval_sec", label: "状态轮询秒", type: "number", min: 0.2, step: 0.1 },
    { key: "max_notification_orders", label: "通知展示条数", type: "number", min: 1 },
    {
      key: "payment_time_range_days",
      label: "通知付款范围",
      type: "select",
      options: [
        { value: "1", label: "今天" },
        { value: "2", label: "2天内" },
        { value: "3", label: "3天内" },
        { value: "5", label: "5天内" },
        { value: "7", label: "7天内" },
      ],
    },
    { key: "browser_executable", label: "浏览器路径" },
    { key: "identity_column_names", label: "订单摘要列" },
    { key: "required_page_texts", label: "订单页识别文字" },
    { key: "auto_start_monitor", label: "启动后台后自动监控", type: "checkbox" },
  ];

  function buildField(def, value) {
    const label = document.createElement("label");
    label.className = def.type === "checkbox" ? "form-row checkbox-row" : "form-row";
    const title = document.createElement("span");
    title.className = "field-label";
    title.textContent = def.label;
    label.appendChild(title);

    const input = def.type === "select" ? buildSelect(def, value) : document.createElement("input");
    if (def.type !== "select") {
      input.name = def.key;
      input.type = def.type || "text";
      if (def.min !== undefined) input.min = String(def.min);
      if (def.step !== undefined) input.step = String(def.step);
      if (def.type === "checkbox") input.checked = Boolean(value);
      else input.value = value ?? "";
    }
    label.appendChild(input);
    return label;
  }

  function buildSelect(def, value) {
    // 该函数用于渲染固定选项配置，避免用户手输天数时出现空值或非法值。
    const select = document.createElement("select");
    select.name = def.key;
    (def.options || []).forEach((option) => {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      select.appendChild(item);
    });
    select.value = String(value || "1");
    return select;
  }

  function renderForm(configForm, form) {
    configForm.innerHTML = "";
    fields.forEach((def) => configForm.appendChild(buildField(def, form[def.key])));
  }

  function collectForm(configForm) {
    const payload = {};
    fields.forEach((def) => {
      const input = configForm.querySelector(`[name="${def.key}"]`);
      if (!input) throw new Error(`表单缺少字段：${def.key}`);
      payload[def.key] = def.type === "checkbox" ? input.checked : input.value;
    });
    return payload;
  }

  window.configFormModule = {
    collectForm,
    renderForm,
  };
})();
