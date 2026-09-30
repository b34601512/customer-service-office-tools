// 读排班表（只读）：调 20号「金山在线表格排班表读取」拿「值矩阵 + 单元格有效底色」，
// 产出 <输出目录>/schedule-report.json（含「当日有色人员」）。本项目不自己解析在线表格 —— 那套
// getAppliedXf/条件格式的坑集中在 20号 工具里（见 20号 经验文档），这里只负责调用与缓存位置。
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const 项目根 = path.resolve(__dirname, "..", "..");
const 默认配置路径 = path.join(项目根, "project-config", "排班值班配置.json");

function 今天() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function 读配置(路径 = 默认配置路径) {
  if (!fs.existsSync(路径)) {
    throw new Error(
      `缺少本地配置 ${路径}\n  照 project-config/排班值班配置.example.json 建一份（scheduleUrl 可从 22号 project-config/wecom-notify.json 抄；该文件不入库）`
    );
  }
  const 配置 = JSON.parse(fs.readFileSync(路径, "utf8"));
  for (const 必须 of ["scheduleUrl", "读取工具"]) {
    if (!配置[必须]) throw new Error(`配置里缺 ${必须}：${路径}`);
  }
  return 配置;
}

/** 读某天的排班报告（真实读表；只读，不写在线文档） */
function 读排班(日期 = 今天(), 配置 = 读配置()) {
  const 输出目录 = 配置.输出目录 || path.join(项目根, "runtime");
  fs.mkdirSync(输出目录, { recursive: true });
  const 参数 = [配置.读取工具, "--url", 配置.scheduleUrl, "--date", 日期, "--out", 输出目录];
  if (配置.工作表) 参数.push("--sheet", 配置.工作表);
  execFileSync(process.execPath, 参数, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: 配置.节点模块路径 || process.env.NODE_PATH || "" },
  });
  const 文件 = path.join(输出目录, "schedule-report.json");
  return JSON.parse(fs.readFileSync(文件, "utf8"));
}

/** 读已落盘的报告（不重新读表） */
function 读已有报告(配置 = 读配置()) {
  const 文件 = path.join(配置.输出目录 || path.join(项目根, "runtime"), "schedule-report.json");
  if (!fs.existsSync(文件)) throw new Error(`没有落盘报告 ${文件}（先跑一次 读排班）`);
  return JSON.parse(fs.readFileSync(文件, "utf8"));
}

module.exports = { 读排班, 读配置, 读已有报告, 今天, 项目根, 默认配置路径 };
