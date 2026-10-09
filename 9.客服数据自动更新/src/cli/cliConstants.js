const packageMetadata = require("../../package.json");

const CLI_VERSION = `v${String(packageMetadata.version || "1.0.1")}`;
const CLI_BRAND_METADATA = Object.freeze({
  authorDisplayName: "黎路遥",
  officialWechatId: "luyao2089",
  officialWebsiteUrl: "https://luyao2089.cc"
});
const PLATFORM_META = {
  tmall: { label: "天猫" },
  jd: { label: "京东" },
  pdd: { label: "拼多多" },
  douyin: { label: "抖音" }
};

module.exports = { CLI_VERSION, CLI_BRAND_METADATA, PLATFORM_META };
