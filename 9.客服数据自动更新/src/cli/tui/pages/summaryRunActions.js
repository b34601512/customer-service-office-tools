// 汇总启动动作的共享真源：总览页快捷操作菜单与汇总页 S/F 快捷键都走这里。
// 页面只触发与展示，执行仍通过 ctx.services.runSummaryTask，与原按键路径完全一致。
const SUMMARY_ACTIONS = [
  { id: "start-all", label: "▶ 开始全部汇总（逐店下载并导入）" },
  { id: "force-all", label: "▶ 全部强制重新下载并汇总（忽略今天源表）" }
];

const FORCE_ALL_CONFIRM_TEXT = "确认对全部启用店铺强制重新下载并汇总？";

function createSummaryRunController() {
  return {
    busy: false,
    message: "",
    start(app, { selectedSummaryTaskIds = null, forceRedownload = false } = {}) {
      if (this.busy) {
        this.message = "汇总正在进行中，请等待完成。";
        app.requestRender();
        return;
      }
      this.busy = true;
      this.message = forceRedownload
        ? "正在强制重新下载并汇总……"
        : "汇总已启动，出现滑块或验证时请在浏览器中人工处理。";
      app.requestRender();
      Promise.resolve()
        .then(() => app.ctx.services.runSummaryTask({ selectedSummaryTaskIds, forceRedownload }))
        .then((result) => {
          this.message = (result && result.detail) || "汇总已结束。";
        })
        .catch((error) => {
          this.message = `汇总停止：${error instanceof Error ? error.message : String(error)}`;
        })
        .finally(() => {
          this.busy = false;
          app.requestRender();
        });
    },
    runAction(app, actionId) {
      if (actionId === "force-all") {
        return app.requestConfirm(FORCE_ALL_CONFIRM_TEXT).then((confirmed) => {
          if (confirmed) {
            this.start(app, { forceRedownload: true });
          }
        });
      }
      this.start(app, {});
      return Promise.resolve();
    }
  };
}

let sharedController = null;

function getSummaryRunController() {
  if (!sharedController) {
    sharedController = createSummaryRunController();
  }
  return sharedController;
}

module.exports = {
  SUMMARY_ACTIONS,
  FORCE_ALL_CONFIRM_TEXT,
  createSummaryRunController,
  getSummaryRunController
};
