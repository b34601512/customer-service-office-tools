// 31号：读 project-config/stores.json，把店铺解析成绝对路径与端口；不含业务判断。
const fs = require("node:fs");
const path = require("node:path");

const 项目根 = path.resolve(__dirname, "..", "..");
const 配置路径 = path.join(项目根, "project-config", "stores.json");

function 读配置() {
  if (!fs.existsSync(配置路径)) throw new Error(`缺少店铺配置：${配置路径}`);
  return JSON.parse(fs.readFileSync(配置路径, "utf8"));
}

function 全部店铺() {
  const 配置 = 读配置();
  return (配置.stores || []).map((s) => ({
    ...s,
    profileDir: path.resolve(项目根, s.profileDir),
    port: Number(s.port)
  }));
}

function 取店铺(key) {
  const 命中 = 全部店铺().find((s) => s.key === key);
  if (!命中) {
    throw new Error(`没找到店铺 ${key}；配置里有：${全部店铺().map((s) => s.key).join(", ")}`);
  }
  return 命中;
}

module.exports = { 项目根, 配置路径, 读配置, 全部店铺, 取店铺 };
