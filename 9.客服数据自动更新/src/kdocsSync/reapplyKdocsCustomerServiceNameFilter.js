const { requireCompleteKdocsSyncSettings } = require("./kdocsSyncSettings");
const { executeKdocsAirScriptSync } = require("./kdocsAirScriptClient");
const {
  KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION,
  KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
  requireCurrentKdocsAirScriptVersion
} = require("./kdocsSyncContract");

function requireIntegerResult(value, fieldLabel, minimumValue = 0) {
  const normalizedValue = Number(value);
  if (!Number.isInteger(normalizedValue) || normalizedValue < minimumValue) {
    throw new Error(`在线“原样确认客服姓名勾选”返回的${fieldLabel}无效。 `);
  }
  return normalizedValue;
}

function normalizeCustomerServiceNameFilterError(error) {
  const errorMessage = String(error?.message || error);
  if (/不支持的操作|AirScript\s*版本不匹配|没有返回(?:写入|执行)结果/.test(errorMessage)) {
    return new Error(
      "在线 AirScript 不是最新的客服姓名确认脚本，请用菜单[8]覆盖客服姓名脚本并按 Ctrl+S 保存。 "
    );
  }
  return error;
}

async function reapplyKdocsCustomerServiceNameFilter({
  projectConfig,
  requestImplementation
}) {
  const syncSettings = requireCompleteKdocsSyncSettings(
    projectConfig?.kdocsDataDetailSync,
    "customerServiceName"
  );
  let remoteResult;
  try {
    remoteResult = await executeKdocsAirScriptSync({
      webhookUrl: syncSettings.webhookUrl,
      apiToken: syncSettings.apiToken,
      contextArguments: {
        operationType: KDOCS_CUSTOMER_SERVICE_NAME_OPERATION,
        requiredScriptVersion: KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION
      },
      requestImplementation
    });
  } catch (error) {
    throw normalizeCustomerServiceNameFilterError(error);
  }

  requireCurrentKdocsAirScriptVersion(remoteResult, KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION, "[8]");
  if (remoteResult.operationType !== KDOCS_CUSTOMER_SERVICE_NAME_OPERATION) {
    throw new Error(
      "在线 AirScript 没有执行客服姓名确认脚本，请用菜单[8]覆盖并保存。 "
    );
  }

  const pivotTableCount = requireIntegerResult(remoteResult.pivotTableCount, "透视表总数", 1);
  const successfulPivotTableCount = requireIntegerResult(remoteResult.successfulPivotTableCount, "成功透视表数");
  const customerServiceNameFilterReappliedPivotTableCount = requireIntegerResult(
    remoteResult.customerServiceNameFilterReappliedPivotTableCount,
    "客服姓名确认透视表数"
  );
  const customerServiceNameVisibleItemCounts = Array.isArray(remoteResult.customerServiceNameVisibleItemCounts)
    ? remoteResult.customerServiceNameVisibleItemCounts
    : [];
  const failedPivotTables = Array.isArray(remoteResult.failedPivotTables)
    ? remoteResult.failedPivotTables
    : [];
  if (
    successfulPivotTableCount + failedPivotTables.length !== pivotTableCount ||
    customerServiceNameFilterReappliedPivotTableCount !== successfulPivotTableCount ||
    customerServiceNameVisibleItemCounts.length !== successfulPivotTableCount
  ) {
    throw new Error("AirScript 返回的客服姓名确认透视表执行数量不一致。 ");
  }
  if (remoteResult.saveCompleted !== true) {
    throw new Error("在线工作簿没有保存完成。 ");
  }

  return {
    scriptVersion: KDOCS_CUSTOMER_SERVICE_NAME_AIRSCRIPT_VERSION,
    pivotTableCount,
    successfulPivotTableCount,
    customerServiceNameFilterReappliedPivotTableCount,
    customerServiceNameVisibleItemCounts,
    failedPivotTableCount: failedPivotTables.length,
    failedPivotTables,
    saveCompleted: true
  };
}

module.exports = {
  requireIntegerResult,
  normalizeCustomerServiceNameFilterError,
  reapplyKdocsCustomerServiceNameFilter
};
