// 该文件记录「交班补判」已经处理过的会话，避免同一个客户被反复转接、反复@主管刷群。
// 只有真的尝试过转接（发出指令）或确实触发了@主管的告警才记一条；普通的“在班不转”不记，
// 否则客户会因为在班被记一次冷却，等原接待下班后就补判不到了。
const fs = require("fs");
const path = require("path");
const appConfig = require("../../config/appConfig");
const { readJsonObjectSafe } = require("../../engine/safeJson");

const MAX_LEDGER_ENTRIES = 200;

function buildEmptyAutoTransferSweepLedger() {
  return { updatedAt: "", attemptsByChatId: {} };
}

function resolveLedgerPath() {
  return appConfig.autoTransferSweepStatePath;
}

function normalizeAutoTransferSweepLedger(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const attemptsByChatId = {};
  const entries = Object.entries(source.attemptsByChatId || {});
  for (const [chatId, attempt] of entries) {
    const normalizedChatId = String(chatId || "").trim();
    if (!normalizedChatId || !attempt || typeof attempt !== "object") {
      continue;
    }

    attemptsByChatId[normalizedChatId] = {
      chatId: normalizedChatId,
      customerName: String(attempt.customerName || "").trim(),
      assigneeUserId: String(attempt.assigneeUserId || "").trim(),
      targetStaffName: String(attempt.targetStaffName || "").trim(),
      outcome: String(attempt.outcome || "").trim(),
      reason: String(attempt.reason || "").trim(),
      attemptedAtMs: Number(attempt.attemptedAtMs || 0)
    };
  }

  return {
    updatedAt: String(source.updatedAt || ""),
    attemptsByChatId
  };
}

function readAutoTransferSweepLedger() {
  // 路径在调用时读取，测试可以替换 appConfig 上的路径做隔离。
  return normalizeAutoTransferSweepLedger(
    readJsonObjectSafe(resolveLedgerPath(), buildEmptyAutoTransferSweepLedger, "交班补判记录")
  );
}

function writeAutoTransferSweepLedger(ledger) {
  const ledgerPath = resolveLedgerPath();
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const normalized = normalizeAutoTransferSweepLedger(ledger);
  // 只保留最近处理的一批会话，避免账本无限增长。
  const keptEntries = Object.values(normalized.attemptsByChatId)
    .sort((left, right) => right.attemptedAtMs - left.attemptedAtMs)
    .slice(0, MAX_LEDGER_ENTRIES);
  const nextLedger = {
    updatedAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    attemptsByChatId: Object.fromEntries(keptEntries.map((entry) => [entry.chatId, entry]))
  };
  fs.writeFileSync(ledgerPath, JSON.stringify(nextLedger, null, 2), "utf8");
  return nextLedger;
}

function recordAutoTransferSweepAttempt(attempt = {}) {
  // 记一次补判尝试：用于冷却窗口与“原接待换人了要重判”的判断。
  const chatId = String(attempt.chatId || "").trim();
  if (!chatId) {
    return readAutoTransferSweepLedger();
  }

  const ledger = readAutoTransferSweepLedger();
  ledger.attemptsByChatId[chatId] = {
    chatId,
    customerName: String(attempt.customerName || "").trim(),
    assigneeUserId: String(attempt.assigneeUserId || "").trim(),
    targetStaffName: String(attempt.targetStaffName || "").trim(),
    outcome: String(attempt.outcome || "").trim(),
    reason: String(attempt.reason || "").trim(),
    attemptedAtMs: Number(attempt.attemptedAtMs) || Date.now()
  };
  return writeAutoTransferSweepLedger(ledger);
}

function readAutoTransferSweepAttempt(chatId) {
  const normalizedChatId = String(chatId || "").trim();
  if (!normalizedChatId) {
    return null;
  }
  return readAutoTransferSweepLedger().attemptsByChatId[normalizedChatId] || null;
}

module.exports = {
  MAX_LEDGER_ENTRIES,
  buildEmptyAutoTransferSweepLedger,
  readAutoTransferSweepAttempt,
  readAutoTransferSweepLedger,
  recordAutoTransferSweepAttempt,
  resolveLedgerPath,
  writeAutoTransferSweepLedger
};
