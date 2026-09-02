const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "download_config.json");
const DEFAULT_DOWNLOAD_DIR = path.join(ROOT_DIR, "downloads");
const DEFAULT_PROFILE_DIR = path.join(ROOT_DIR, "runtime", "browser_profiles", "phone_data_downloader");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function buildDateRange(days) {
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, Number(days) || 30) - 1) * 24 * 60 * 60 * 1000);
  const fmt = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { startDate: fmt(start), endDate: fmt(end) };
}

function loadDownloadConfig(configPath) {
  const rawConfig = readJson(configPath || DEFAULT_CONFIG_PATH, {});
  const dateRange = buildDateRange(rawConfig.days || 30);
  return {
    baseUrl: rawConfig.baseUrl || "http://127.0.0.1:9001/",
    companyCode: rawConfig.companyCode || "",
    account: rawConfig.account || "",
    password: rawConfig.password || "",
    days: rawConfig.days || 30,
    startDate: rawConfig.startDate || dateRange.startDate,
    endDate: rawConfig.endDate || dateRange.endDate,
    debugPort: Number(rawConfig.debugPort || 9876),
    loginWaitMs: Number(rawConfig.loginWaitMs || 120000),
    downloadWaitMs: Number(rawConfig.downloadWaitMs || 90000),
    downloadDir: rawConfig.downloadDir || DEFAULT_DOWNLOAD_DIR,
    profileDir: rawConfig.profileDir || DEFAULT_PROFILE_DIR,
    browserPath: rawConfig.browserPath || ""
  };
}

module.exports = {
  DEFAULT_CONFIG_PATH,
  loadDownloadConfig
};
