const fs = require("fs");
const appConfig = require("../config/appConfig");
const { readJsonFile, writeJsonFileAtomic } = require("../shared/fileStore");
const { sanitizeKdocsDiagnosticText } = require("./kdocsSyncContract");

const KDOCS_SYNC_RECEIPT_LIMIT = 100;
const sensitiveReceiptKeys = new Set([
  "apitoken",
  "token",
  "webhook",
  "webhookurl",
  "documenturl",
  "documentid",
  "fileid",
  "scriptid"
]);

function resolveKdocsSyncReceiptPath() {
  return process.env.CUSTOMER_PERFORMANCE_KDOCS_SYNC_RECEIPT_PATH || appConfig.kdocsSyncReceiptPath;
}

function isSensitiveReceiptKey(key) {
  const normalizedKey = String(key).replace(/[_-]/g, "").toLowerCase();
  return sensitiveReceiptKeys.has(normalizedKey) || normalizedKey.endsWith("token");
}

function sanitizeReceiptValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeReceiptValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSensitiveReceiptKey(key))
        .map(([key, nestedValue]) => [key, sanitizeReceiptValue(nestedValue)])
    );
  }
  return typeof value === "string" ? sanitizeKdocsDiagnosticText(value) : value;
}

function createEmptyKdocsSyncReceiptHistory() {
  return { schemaVersion: 1, receipts: [] };
}

function readKdocsSyncReceiptHistory() {
  const receiptPath = resolveKdocsSyncReceiptPath();
  if (!fs.existsSync(receiptPath)) {
    return createEmptyKdocsSyncReceiptHistory();
  }
  const payload = readJsonFile(receiptPath, "金山同步回执");
  return {
    schemaVersion: 1,
    receipts: Array.isArray(payload.receipts) ? payload.receipts.map(sanitizeReceiptValue) : []
  };
}

function appendKdocsSyncReceipt(receipt) {
  const history = readKdocsSyncReceiptHistory();
  const sanitizedReceipt = sanitizeReceiptValue(receipt);
  history.receipts = [sanitizedReceipt, ...history.receipts].slice(0, KDOCS_SYNC_RECEIPT_LIMIT);
  writeJsonFileAtomic(resolveKdocsSyncReceiptPath(), history);
  return sanitizedReceipt;
}

module.exports = {
  KDOCS_SYNC_RECEIPT_LIMIT,
  resolveKdocsSyncReceiptPath,
  isSensitiveReceiptKey,
  sanitizeReceiptValue,
  createEmptyKdocsSyncReceiptHistory,
  readKdocsSyncReceiptHistory,
  appendKdocsSyncReceipt
};
