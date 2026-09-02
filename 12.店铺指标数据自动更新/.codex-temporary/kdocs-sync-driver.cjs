const path = require("path");
const root = process.cwd();
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1,localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
const { readStoreMetricConfig } = require(path.join(root, "src/config/storeMetricConfig"));
const { syncDataSourceToKdocs } = require(path.join(root, "src/kdocsSync/syncDataSourceToKdocs"));

(async () => {
  try {
    const projectConfig = readStoreMetricConfig();
    console.log("开始同步，本地数据源:", projectConfig.workbook.path);
    const result = await syncDataSourceToKdocs({ projectConfig });
    console.log("SYNC_OK", JSON.stringify(result, null, 2));
    process.exitCode = 0;
  } catch (error) {
    console.error("SYNC_ERROR", String(error?.stack || error?.message || error));
    process.exitCode = 1;
  }
})();
