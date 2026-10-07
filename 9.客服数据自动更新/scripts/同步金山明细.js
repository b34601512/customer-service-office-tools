// 9号项目「只同步」脚本：不采集、不改本地数据，只把本地汇总表『数据明细』全量覆盖到金山在线文档。
// 等价 TUI「5 金山 → 一键同步明细」+「设置透视筛选日期（回车=数据最新日期）」两步。
// 用法：node scripts/同步金山明细.js
const path = require("path");
process.chdir(path.resolve(__dirname, ".."));

const { readProjectConfig } = require("../src/config/projectConfigServiceParts/projectConfigPersistence");
const { syncDataDetailToKdocs } = require("../src/kdocsSync/syncDataDetailToKdocs");
const { updateKdocsPivotEndDateFilter } = require("../src/kdocsSync/updateKdocsPivotEndDateFilter");

async function main() {
  // 只读配置，不做启动初始化：初始化会重算导出日期范围（属于采集路径），只同步时不需要。
  const projectConfig = readProjectConfig();

  const syncResult = await syncDataDetailToKdocs({ projectConfig });
  console.log("同步明细完成", JSON.stringify({
    本地行数: syncResult.localDataRowCount,
    在线回读行数: syncResult.remoteDataRowCount,
    在线最后一行: syncResult.remoteLastRowNumber,
    清理旧尾行数: syncResult.clearedTailRowCount
  }));

  const filterResult = await updateKdocsPivotEndDateFilter({ projectConfig, filterDate: "" });
  console.log("透视筛选完成", JSON.stringify({
    设定日期: filterResult.filterDate,
    透视表总数: filterResult.pivotTableCount,
    成功: filterResult.successfulPivotTableCount,
    失败: filterResult.failedPivotTableCount,
    失败明细: filterResult.failedPivotTables
  }));

  if (syncResult.remoteDataRowCount !== syncResult.localDataRowCount) {
    throw new Error("在线回读行数与本地不一致。");
  }
}

main()
  .then(() => { console.log("只同步完成"); process.exit(0); })
  .catch((error) => { console.error("只同步失败：" + (error && error.stack ? error.stack : error)); process.exit(1); });
