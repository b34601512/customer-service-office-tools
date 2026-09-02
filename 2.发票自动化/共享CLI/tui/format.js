// 通用格式化工具：时长、倒计时、状态标签、布尔值等，页面只消费这里的结果。
const { 适配宽度 } = require("./width");

function 格式化时长毫秒(已过毫秒) {
  const 总秒数 = Math.floor(Math.max(0, Number(已过毫秒) || 0) / 1000);
  if (总秒数 <= 0) {
    return "刚刚";
  }
  const 小时 = Math.floor(总秒数 / 3600);
  const 分钟 = Math.floor((总秒数 % 3600) / 60);
  const 秒 = 总秒数 % 60;
  if (小时 > 0) {
    return `${小时}小时${String(分钟).padStart(2, "0")}分`;
  }
  if (分钟 > 0) {
    return `${分钟}分${String(秒).padStart(2, "0")}秒`;
  }
  return `${秒}秒`;
}

function 格式化时钟(日期 = new Date()) {
  const 补两位 = (数值) => String(数值).padStart(2, "0");
  return `${日期.getFullYear()}-${补两位(日期.getMonth() + 1)}-${补两位(日期.getDate())} ${补两位(日期.getHours())}:${补两位(日期.getMinutes())}:${补两位(日期.getSeconds())}`;
}

function 格式化时间文本(值) {
  if (!值) {
    return "暂无";
  }
  const 日期 = new Date(值);
  if (Number.isNaN(日期.getTime())) {
    return String(值);
  }
  return 格式化时钟(日期);
}

function 格式化任务状态(任务) {
  if (!任务 || 任务.status === "idle") {
    return { 标签: "空闲", 颜色: "gray" };
  }
  const 状态映射 = {
    running: { 标签: "运行中", 颜色: "brightGreen" },
    stopping: { 标签: "停止中", 颜色: "yellow" },
    failed: { 标签: "失败", 颜色: "brightRed" },
    done: { 标签: "已完成", 颜色: "brightGreen" },
    idle: { 标签: "已结束", 颜色: "gray" },
  };
  return 状态映射[任务.status] || { 标签: String(任务.status || "未知"), 颜色: "gray" };
}

function 格式化布尔值(值) {
  return 值 ? "是" : "否";
}

function 补齐行到等宽(行列表, 宽度) {
  return 行列表.map((行) => 适配宽度(行, 宽度));
}

module.exports = {
  格式化时长毫秒,
  格式化时钟,
  格式化时间文本,
  格式化任务状态,
  格式化布尔值,
  补齐行到等宽,
};
