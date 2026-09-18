// 本文件只做两件事：读 project-config/stores.json、把店铺解析成绝对路径与端口，不含业务判断。
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "project-config", "stores.json");

function readStoreConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`缺少店铺配置：${CONFIG_PATH}`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function listPlatforms() {
  const config = readStoreConfig();
  return Object.entries(config.platforms || {}).map(([key, value]) => ({
    key,
    label: value.label || key,
    backendUrl: value.backendUrl || "",
    stores: (value.stores || []).map((store) => ({ ...store, platformKey: key }))
  }));
}

function listStores(platformKey) {
  return listPlatforms()
    .filter((platform) => !platformKey || platform.key === platformKey)
    .flatMap((platform) => platform.stores);
}

// 解析一个店铺：--platform/--store 组合（推荐）或直接 --profile（临时探路用）。
// 返回值里带上所属平台的 backendUrl，调用方可以用它当默认目标地址。
function resolveStore({ platform, store }) {
  const platformItem = listPlatforms().find((item) => item.key === platform);
  const hit = (platformItem?.stores || []).find((item) => item.key === store);
  if (!hit) {
    const available = listStores().map((item) => `${item.platformKey}/${item.key}`).join(", ") || "(空)";
    throw new Error(`没找到店铺 ${platform || "?"}/${store || "?"}；配置里有：${available}`);
  }
  return {
    ...hit,
    backendUrl: platformItem?.backendUrl || "",
    profileDir: path.resolve(PROJECT_ROOT, hit.profileDir),
    port: Number(hit.port)
  };
}

function projectPath(...parts) {
  return path.join(PROJECT_ROOT, ...parts);
}

module.exports = { PROJECT_ROOT, CONFIG_PATH, readStoreConfig, listPlatforms, listStores, resolveStore, projectPath };
