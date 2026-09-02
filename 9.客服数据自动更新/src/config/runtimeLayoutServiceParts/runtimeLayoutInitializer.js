// 该文件用于解决 runtime 初始化主流程编排问题。
const appConfig = require("../appConfig");
const { log } = require("../../engine/logger");
const { migrateRuntimeLayoutFromSource } = require("./runtimeSourceMigration");
const { ensureRuntimeFolders } = require("./runtimeFolderInitializer");

let hasInitialized = false;

function initializeRuntimeLayout(runtimeConfig = appConfig, dependencies = {}) {
  // 这个函数只负责 runtime 分层初始化总编排，缓存清理由启动和退出入口按安全时机触发。
  if (hasInitialized) {
    return runtimeConfig.runtime;
  }

  const logFn = dependencies.logFn || log;
  logFn("主线:执行", "运行目录", "初始化结构", `根目录=${runtimeConfig.runtime.root}`);
  migrateRuntimeLayoutFromSource(runtimeConfig, dependencies);
  ensureRuntimeFolders(runtimeConfig);
  hasInitialized = true;
  logFn("主线:完成", "运行目录", "初始化结构", "已完成状态区、缓存区、产出区分层");
  return runtimeConfig.runtime;
}

module.exports = {
  initializeRuntimeLayout
};
