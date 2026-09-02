// 金山同步设置编辑器：settings 页与 kdocs 页共用同一套 3 字段编辑流程。
// 校验与保存全部走 services，页面不直接触碰配置存储。
async function editKdocsSyncSettings(app, page) {
  const services = app.ctx.services;
  const config = services.readConfig();
  const current = config.kdocsDataSourceSync || {};
  const documentUrl = await app.requestInput({
    title: "在线文档分享地址（回车保留原值）",
    defaultValue: current.documentUrl || ""
  });
  if (documentUrl === null) return;
  const webhookUrl = await app.requestInput({
    title: "数据源脚本 webhook（回车保留原值）",
    defaultValue: current.webhookUrl || ""
  });
  if (webhookUrl === null) return;
  const apiToken = await app.requestInput({
    title: "数据源脚本令牌（回车保留原值）",
    secret: true,
    defaultValue: current.apiToken || ""
  });
  if (apiToken === null) return;
  try {
    const nextSettings = {
      documentUrl: documentUrl ? services.validateKdocsDocumentUrl(documentUrl) : current.documentUrl || "",
      webhookUrl: webhookUrl ? services.validateKdocsWebhookUrl(webhookUrl) : current.webhookUrl || "",
      apiToken: apiToken || current.apiToken || ""
    };
    services.saveKdocsSyncSettings(nextSettings);
    page.state.message = "金山同步设置已保存。";
  } catch (error) {
    page.state.message = `保存失败：${String(error?.message || error)}`;
  }
  app.requestRender();
}

module.exports = {
  editKdocsSyncSettings
};