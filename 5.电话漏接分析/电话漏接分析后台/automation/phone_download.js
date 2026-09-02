const fs = require("fs");
const { DEFAULT_CONFIG_PATH, loadDownloadConfig } = require("./phone_download_lib/config");
const { launchBrowser, closeCreatedTarget } = require("./phone_download_lib/browser_session");
const { downloadOneReport } = require("./phone_download_lib/download_report_flow");
const { log } = require("./phone_download_lib/logger");

async function main() {
  const config = loadDownloadConfig(process.argv[2] || DEFAULT_CONFIG_PATH);
  if (!config.companyCode || !config.account || !config.password) {
    log("提示", "未配置完整账号密码，将打开页面等待你手工登录。");
  }

  fs.mkdirSync(config.downloadDir, { recursive: true });
  const browserSession = await launchBrowser(config);
  try {
    const lossFile = await downloadOneReport(config, "loss", browserSession);
    const inboundFile = await downloadOneReport(config, "inbound", browserSession);
    const outboundFile = await downloadOneReport(config, "outbound", browserSession);
    return { ok: true, lossFile, inboundFile, outboundFile, startDate: config.startDate, endDate: config.endDate };
  } finally {
    await closeCreatedTarget(browserSession);
  }
}

main().then((payload) => {
  console.log(JSON.stringify(payload, null, 2));
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message }, null, 2));
  process.exit(1);
});
