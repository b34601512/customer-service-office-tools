// 该文件用于绑定首页按钮事件并启动页面初始化。
function bindActions() {
  // 这里统一绑定首页操作事件，入口只保留启动、查看和跳转。
  if (openCountdownModalButton && closeCountdownModalButton && countdownModal) {
    customerMirrorCountdown.bind();
    openCountdownModalButton.addEventListener("click", openCountdownModal);
    closeCountdownModalButton.addEventListener("click", closeCountdownModal);
    countdownModal.addEventListener("click", (event) => {
      if (event.target === countdownModal) {
        closeCountdownModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && customerMirrorCountdown.closeDetailIfVisible()) {
        return;
      }
      if (event.key === "Escape" && !countdownModal.classList.contains("hidden")) {
        closeCountdownModal();
      }
    });
  }

  if (openResourceUsageModalButton && closeResourceUsageModalButton && resourceUsageModal) {
    openResourceUsageModalButton.addEventListener("click", openResourceUsageModal);
    closeResourceUsageModalButton.addEventListener("click", closeResourceUsageModal);
    if (refreshResourceUsageButton) {
      refreshResourceUsageButton.addEventListener("click", refreshResourceUsage);
    }
    resourceUsageModal.addEventListener("click", (event) => {
      if (event.target === resourceUsageModal) {
        closeResourceUsageModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !resourceUsageModal.classList.contains("hidden")) {
        closeResourceUsageModal();
      }
    });
  }

  document.querySelectorAll("[data-task]").forEach((button) => {
    button.addEventListener("click", async () => {
      const actionLabel = button.textContent;
      const pendingText = button.dataset.task === "start" ? "正在启动..." : "正在处理...";
      setButtonBusy(button, pendingText);
      setFeedback(`已收到「${actionLabel}」指令，正在处理。`, false, {
        type: "pending",
        title: "正在处理",
        workflowStep: button.dataset.task,
        showToast: false
      });
      try {
        const result = await requestJson("/api/tasks/start", {
          method: "POST",
          body: JSON.stringify({ taskName: button.dataset.task })
        });
        clearButtonBusy(button);
        setFeedback(result.message, false, {
          type: "success",
          title: "任务已响应",
          workflowStep: button.dataset.task
        });
      } catch (error) {
        clearButtonBusy(button);
        setFeedback(error.message, true, {
          title: "任务未执行",
          workflowStep: button.dataset.task
        });
      }
    });
  });

  document.querySelectorAll("[data-link]").forEach((button) => {
    button.addEventListener("click", () => {
      window.open(button.dataset.link, "_blank", "noopener");
      setFeedback(`已打开「${button.textContent}」。`, false, {
        type: "success",
        title: "已打开",
        workflowStep: "result"
      });
    });
  });

  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      setFeedback(`正在打开「${button.textContent}」。`, false, {
        type: "pending",
        title: "正在打开",
        workflowStep: "result",
        showToast: false
      });
      window.location.href = button.dataset.route;
    });
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const actionLabel = button.textContent;
      setButtonBusy(button, "正在处理...");
      setFeedback(`正在执行「${actionLabel}」。`, false, {
        type: "pending",
        title: "正在处理",
        workflowStep: "result",
        showToast: false
      });
      try {
        const result = await requestJson(`/api/actions/${button.dataset.action}`, {
          method: "POST",
          body: "{}"
        });
        clearButtonBusy(button);
        setFeedback(result.message, false, {
          type: "success",
          title: "动作已完成",
          workflowStep: "result"
        });
      } catch (error) {
        clearButtonBusy(button);
        setFeedback(error.message, true, {
          title: "动作失败",
          workflowStep: "result"
        });
      }
    });
  });

  confirmLoginButton.addEventListener("click", async () => {
    setButtonBusy(confirmLoginButton, "正在确认...");
    setFeedback("正在确认人工登录结果。", false, {
      type: "pending",
      title: "正在处理",
      workflowStep: "login",
      showToast: false
    });
    try {
      const result = await requestJson("/api/tasks/confirm-login", {
        method: "POST",
        body: "{}"
      });
      clearButtonBusy(confirmLoginButton);
      setFeedback(result.message, false, {
        type: "success",
        title: "确认已发送",
        workflowStep: "login"
      });
    } catch (error) {
      clearButtonBusy(confirmLoginButton);
      setFeedback(error.message, true, {
        title: "确认失败",
        workflowStep: "login"
      });
    }
  });

  stopTaskButton.addEventListener("click", async () => {
    try {
      isControlCenterClosing = true;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      const result = await requestJson("/api/control-center/shutdown", {
        method: "POST",
        body: "{}"
      });
      setFeedback(result.message, false, {
        type: "pending",
        title: "正在退出",
        workflowStep: currentTask?.taskName || "start",
        showToast: true
      });
      stopTaskButton.disabled = true;
      stopTaskButton.textContent = "正在退出";
      setTimeout(() => {
        try {
          window.close();
        } catch (error) {
          // 这里静默尝试关闭当前页；浏览器若不允许脚本关窗，直接留给用户忽略即可。
        }
      }, 200);
    } catch (error) {
      setFeedback(error.message, true, {
        title: "退出失败",
        workflowStep: currentTask?.taskName || "start"
      });
    }
  });
}

function subscribeEvents() {
  // 这里统一订阅 SSE 实时事件，让任务状态可以随着后台变化实时刷新。
  eventSource = new EventSource("/api/events");

  eventSource.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    renderTask(payload.currentTask);
  });

  eventSource.onerror = () => {
    if (isControlCenterClosing) {
      return;
    }

    setFeedback("关键事件连接暂时中断，页面会自动重连。", true, {
      type: "error",
      title: "连接异常",
      workflowStep: currentTask?.taskName || "start"
    });
  };
}

async function bootstrap() {
  // 这里统一编排首页初始化顺序，保证界面先拿到状态再进入实时更新。
  bindActions();
  await loadInitialState();
  startLiveRefresh();
  subscribeEvents();
}

function shouldAutoBootstrap() {
  // 这里给测试环境留一个显式开关，避免脚本一加载就发请求导致前端回归测试失真。
  return typeof window !== "undefined" && window.__CONTROL_CENTER_DISABLE_BOOTSTRAP__ !== true;
}

if (shouldAutoBootstrap()) {
  bootstrap().catch((error) => {
    setFeedback(error.message, true, {
      title: "页面初始化失败"
    });
  });
}
