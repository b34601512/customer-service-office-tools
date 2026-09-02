// 共享镜像表格：先由页面提供“系统看到的数据镜像”，再统一渲染成固定列表格。
// 客服督办控制台的客户页采用同一思路；发票项目用它展示店铺和订单明细。
const { 着色 } = require("./ansi");
const { 截断, 右侧补齐, 显示宽度 } = require("./width");
const {
  读取工作流状态,
  工作流状态中文,
  读取平台状态,
} = require("../../共享订单状态/orderWorkflow");

function 压缩单行文本(值) {
  return String(值 ?? "").replace(/\s+/g, " ").trim();
}

function 规范化表格单元格文本(值) {
  // 表格边框使用 │；业务状态里如果再保留 ｜、| 或已经由后台截好的 ...，
  // 人眼会把它们误认为列边界，尤其是中英文混排时更明显。
  // 先统一成非竖线分隔符，并移除尾部旧省略号，再由本层按真实列宽截断一次。
  return 压缩单行文本(值)
    .replace(/[|｜│]/g, " · ")
    .replace(/(?:\.{2,}|…+)\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function 格式化日期文本(值) {
  // 解决：识别/记录时间是 UTC ISO 字符串，转成本地日期便于订单列表直接核对是哪天发现的。
  if (!值) return "";
  const 日期 = new Date(值);
  if (Number.isNaN(日期.getTime())) return String(值);
  const 补两位 = (数值) => String(数值).padStart(2, "0");
  return `${日期.getFullYear()}-${补两位(日期.getMonth() + 1)}-${补两位(日期.getDate())}`;
}

function 计算固定列宽(列定义) {
  return (列定义 || []).reduce((合计, 列) => 合计 + (列.宽度 === "flex" ? 0 : Number(列.宽度 || 0)), 0);
}

function 计算动态列宽(列定义, 列数) {
  const 固定宽度 = 计算固定列宽(列定义);
  const 分隔符宽度 = Math.max(0, (列定义 || []).length - 1);
  return Math.max(8, Number(列数 || 0) - 固定宽度 - 分隔符宽度);
}

function 读取单元格对象(值) {
  return 值 && typeof 值 === "object" ? 值 : { 文本: 值 };
}

function 读取单元格文本(值) {
  const 对象值 = 读取单元格对象(值);
  return 规范化表格单元格文本(对象值.文本 ?? 值 ?? "");
}

function 计算表格宽度方案(列定义, 行值列表 = [], 列数 = 80) {
  const 定义列表 = Array.isArray(列定义) ? 列定义 : [];
  const 行列表 = Array.isArray(行值列表) ? 行值列表 : [];
  const 分隔符数量 = Math.max(0, 定义列表.length - 1);
  const 可用内容宽度 = Math.max(1, Number(列数 || 80) - 分隔符数量);
  const 列规格列表 = 定义列表.map((列, 索引) => {
    const 是弹性列 = 列.宽度 === "flex";
    const 原始宽度 = 是弹性列 ? 0 : Math.max(1, Number(列.宽度 || 1));
    const 最小宽度 = Math.max(
      1,
      Number(列.最小宽度 ?? (是弹性列 ? 8 : 原始宽度)),
    );
    const 自然宽度 = Math.max(
      显示宽度(压缩单行文本(列.标题 || "")),
      ...行列表.map((值列表) => 显示宽度(读取单元格文本(值列表?.[索引]))),
    );
    const 最大宽度配置 = Number(列.最大宽度);
    const 最大宽度 = Number.isFinite(最大宽度配置)
      ? Math.max(最小宽度, 最大宽度配置)
      : Math.max(最小宽度, 自然宽度);
    const 首选宽度 = 是弹性列
      ? 最小宽度
      : Math.max(最小宽度, Math.min(自然宽度, 最大宽度));
    return { 是弹性列, 最小宽度, 最大宽度, 首选宽度 };
  });

  const 宽度列表 = 列规格列表.map((规格) => 规格.首选宽度);
  const 最小宽度列表 = 列规格列表.map((规格) => 规格.最小宽度);
  const 弹性列索引 = 列规格列表
    .map((规格, 索引) => (规格.是弹性列 ? 索引 : -1))
    .filter((索引) => 索引 >= 0);

  // 终端较窄时先压缩弹性列，再压缩普通列；始终让每一列保留同一宽度，
  // 避免“表头一套宽度、每行一套宽度”造成的视觉错位。
  let 超出宽度 = () => Math.max(0, 宽度列表.reduce((合计, 宽度) => 合计 + 宽度, 0) - 可用内容宽度);
  while (超出宽度() > 0) {
    const 可压缩索引 = [...弹性列索引, ...宽度列表.map((_, 索引) => 索引)]
      .filter((索引, 位置, 列表) => 列表.indexOf(索引) === 位置)
      .filter((索引) => 宽度列表[索引] > 最小宽度列表[索引]);
    if (可压缩索引.length === 0) break;
    const 目标索引 = 可压缩索引.sort((左侧, 右侧) => 宽度列表[右侧] - 宽度列表[左侧])[0];
    宽度列表[目标索引] -= Math.min(超出宽度(), 宽度列表[目标索引] - 最小宽度列表[目标索引]);
  }

  // 如果所有声明的最小宽度仍然超过极窄终端，最后按 1 格兜底压缩，
  // 由单元格截断显示省略号，但不会再把后面的列推歪。
  while (超出宽度() > 0) {
    const 目标索引 = 宽度列表.findIndex((宽度) => 宽度 > 1);
    if (目标索引 < 0) break;
    宽度列表[目标索引] -= 1;
  }

  if (弹性列索引.length > 0) {
    let 剩余宽度 = Math.max(0, 可用内容宽度 - 宽度列表.reduce((合计, 宽度) => 合计 + 宽度, 0));
    let 游标 = 0;
    while (剩余宽度 > 0) {
      const 索引 = 弹性列索引[游标 % 弹性列索引.length];
      const 最大宽度 = 列规格列表[索引].最大宽度;
      if (!Number.isFinite(最大宽度) || 宽度列表[索引] < 最大宽度) {
        宽度列表[索引] += 1;
        剩余宽度 -= 1;
      }
      游标 += 1;
      if (游标 > 剩余宽度 + 弹性列索引.length * 2 && 弹性列索引.every((列索引) => (
        Number.isFinite(列规格列表[列索引].最大宽度)
          && 宽度列表[列索引] >= 列规格列表[列索引].最大宽度
      ))) break;
    }
  }

  return {
    宽度列表,
    总宽度: 宽度列表.reduce((合计, 宽度) => 合计 + 宽度, 0) + 分隔符数量,
  };
}

function 读取表格宽度列表(列定义, 列数, 宽度方案) {
  if (宽度方案 && Array.isArray(宽度方案.宽度列表)) {
    return 宽度方案.宽度列表;
  }
  const 动态宽度 = 计算动态列宽(列定义, 列数);
  return (列定义 || []).map((列) => (
    列.宽度 === "flex" ? 动态宽度 : Number(列.宽度 || 0)
  ));
}

function 构建表头(列定义, 列数, 宽度方案 = null) {
  const 宽度列表 = 读取表格宽度列表(列定义, 列数, 宽度方案);
  const 单元格列表 = (列定义 || []).map((列, 索引) => {
    const 宽度 = 宽度列表[索引] || 1;
    return 右侧补齐(截断(列.标题 || "", 宽度), 宽度);
  });
  return 着色(单元格列表.join("│"), "brightBlue");
}

function 构建表格行(列定义, 值列表, 列数, 宽度方案 = null) {
  const 宽度列表 = 读取表格宽度列表(列定义, 列数, 宽度方案);
  const 单元格列表 = (列定义 || []).map((列, 索引) => {
    const 宽度 = 宽度列表[索引] || 1;
    const 值 = 值列表?.[索引];
    const 对象值 = 读取单元格对象(值);
    const 文本 = 读取单元格文本(值);
    const 单元格 = 右侧补齐(截断(文本, 宽度), 宽度);
    return 对象值.颜色 ? 着色(单元格, 对象值.颜色) : 单元格;
  });
  return 单元格列表.join("│");
}

const 回传状态映射 = {
  queued: { 文本: "等待", 颜色: "gray" },
  downloading: { 文本: "下载中", 颜色: "brightYellow" },
  downloaded: { 文本: "已下载", 颜色: "brightCyan" },
  uploading: { 文本: "上传中", 颜色: "brightYellow" },
  success: { 文本: "成功", 颜色: "brightGreen" },
  skipped: { 文本: "跳过", 颜色: "yellow" },
  error: { 文本: "失败", 颜色: "brightRed" },
};

const 工作流颜色映射 = {
  pending: "yellow",
  processing: "brightYellow",
  invoice_registered: "brightCyan",
  handled: "brightGreen",
};

function 读取回传状态定义(尝试状态, 订单) {
  const 状态 = String(尝试状态 || (订单?.invoiceReturned ? "success" : ""));
  return 回传状态映射[状态] || { 文本: 状态 || "未回传", 颜色: "gray" };
}

function 构建订单镜像(订单) {
  const workflowStatus = 读取工作流状态(订单);
  const platform = 读取平台状态(订单);
  const 尝试状态 = String(订单?.lastReturnAttempt?.status || "");
  const 回传定义 = 读取回传状态定义(尝试状态, 订单);
  const 最近消息 = 压缩单行文本(
    订单?.lastReturnAttempt?.message
    || 订单?.invoiceReturnMessage
    || 订单?.rowText
    || 订单?.summary
    || 订单?.noteText
    || "",
  );
  return {
    key: String(订单?.key || 订单?.orderKey || `${订单?.storeId || ""}:${订单?.orderNumber || ""}`),
    storeId: String(订单?.storeId || ""),
    storeName: String(订单?.storeName || 订单?.storeId || "未命名店铺"),
    orderNumber: String(订单?.orderNumber || 订单?.orderNo || 订单?.orderId || 订单?.id || "-"),
    platformText: platform.text,
    platformKind: platform.kind,
    workflowStatus,
    workflowText: 工作流状态中文[workflowStatus] || workflowStatus,
    returnStatus: 尝试状态,
    returnText: 回传定义.文本,
    returnColor: 回传定义.颜色,
    lastMessage: 最近消息,
    detectedText: 格式化日期文本(订单?.addedAt || 订单?.createdAt || 订单?.updatedAt) || "",
    updatedAt: String(订单?.updatedAt || ""),
    原订单: 订单,
  };
}

function 构建订单镜像列表(订单列表) {
  const 排序权重 = {
    pending: 0,
    processing: 1,
    invoice_registered: 2,
    handled: 3,
  };
  return (Array.isArray(订单列表) ? 订单列表 : [])
    .map((订单) => 构建订单镜像(订单))
    .sort((左侧, 右侧) => {
      const 权重差 = (排序权重[左侧.workflowStatus] ?? 4) - (排序权重[右侧.workflowStatus] ?? 4);
      if (权重差 !== 0) return 权重差;
      return String(右侧.updatedAt || "").localeCompare(String(左侧.updatedAt || ""));
    });
}

function 订单是否需关注(镜像) {
  if (!镜像) return false;
  // 平台已经确认开票成功时，无论本地人工阶段是否尚未收敛，都不再列入需关注队列。
  if (镜像.platformKind === "success" || /开票成功/.test(镜像.platformText || "")) return false;
  return ["pending", "processing"].includes(镜像.workflowStatus)
    || ["error", "downloading", "uploading"].includes(镜像.returnStatus);
}

function 订单是否失败(镜像) {
  return Boolean(镜像 && (镜像.returnStatus === "error" || /失败|失效/.test(镜像.lastMessage || "")));
}

const 订单过滤模式 = [
  { id: "attention", label: "需关注", test: 订单是否需关注 },
  { id: "failed", label: "失败", test: 订单是否失败 },
  { id: "all", label: "全部", test: () => true },
];

function 过滤订单镜像列表(镜像列表, 模式索引 = 0) {
  const 模式 = 订单过滤模式[模式索引] || 订单过滤模式[0];
  return 镜像列表.filter(模式.test);
}

function 切换订单过滤模式(当前索引) {
  return (当前索引 + 1) % 订单过滤模式.length;
}

const 订单表格列定义 = [
  { 标题: "#", 宽度: 4, 最小宽度: 3, 最大宽度: 4 },
  { 标题: "订单号", 宽度: 22, 最小宽度: 14, 最大宽度: 22 },
  { 标题: "店铺", 宽度: 12, 最小宽度: 8, 最大宽度: 22 },
  { 标题: "平台状态", 宽度: 12, 最小宽度: 10, 最大宽度: 26 },
  { 标题: "人工阶段", 宽度: 10, 最小宽度: 8, 最大宽度: 16 },
  { 标题: "回传", 宽度: 8, 最小宽度: 6, 最大宽度: 12 },
  { 标题: "识别日期", 宽度: 12, 最小宽度: 10, 最大宽度: 12 },
  { 标题: "最近消息", 宽度: "flex", 最小宽度: 8 },
];

function 读取平台状态颜色(kind) {
  if (kind === "success" || kind === "returnable" || kind === "closed") return "brightGreen";
  if (kind === "pending") return "yellow";
  if (kind === "danger" || kind === "error") return "brightRed";
  return "gray";
}

function 构建订单表格列定义(扩展列 = []) {
  return [...订单表格列定义, ...(Array.isArray(扩展列) ? 扩展列 : [])];
}

function 构建订单表格值列表(索引, 镜像, 扩展列 = []) {
  const 扩展单元格 = (Array.isArray(扩展列) ? 扩展列 : []).map((列) => ({
    文本: typeof 列.取值 === "function" ? 列.取值(镜像) : "-",
    颜色: typeof 列.颜色 === "function" ? 列.颜色(镜像) : (列.颜色 || ""),
  }));
  return [
    { 文本: String(索引 + 1), 颜色: "gray" },
    { 文本: 镜像.orderNumber },
    { 文本: 镜像.storeName },
    { 文本: 镜像.platformText, 颜色: 读取平台状态颜色(镜像.platformKind) },
    { 文本: 镜像.workflowText, 颜色: 工作流颜色映射[镜像.workflowStatus] || "gray" },
    { 文本: 镜像.returnText, 颜色: 镜像.returnColor },
    { 文本: 镜像.detectedText || "-", 颜色: "gray" },
    { 文本: 镜像.lastMessage || "-", 颜色: 镜像.returnStatus === "error" ? "brightRed" : "" },
    ...扩展单元格,
  ];
}

function 构建订单表格宽度方案(列数, 扩展列 = [], 镜像列表 = []) {
  const 定义列表 = 构建订单表格列定义(扩展列);
  const 行列表 = (Array.isArray(镜像列表) ? 镜像列表 : [])
    .map((镜像, 索引) => 构建订单表格值列表(索引, 镜像, 扩展列));
  return 计算表格宽度方案(定义列表, 行列表, 列数);
}

function 构建订单表格头(列数, 扩展列 = [], 宽度方案 = null) {
  return 构建表头(构建订单表格列定义(扩展列), 列数, 宽度方案);
}

function 构建订单表格行(索引, 镜像, 列数, 扩展列 = [], 宽度方案 = null) {
  return 构建表格行(
    构建订单表格列定义(扩展列),
    构建订单表格值列表(索引, 镜像, 扩展列),
    列数,
    宽度方案,
  );
}

function 渲染订单详情(镜像) {
  const 订单 = 镜像?.原订单 || {};
  const 尝试 = 订单.lastReturnAttempt || {};
  const 行列表 = [];
  行列表.push(着色(`订单：${镜像?.orderNumber || "-"}`, "brightCyan"));
  行列表.push(`店铺：${镜像?.storeName || "-"}｜人工阶段：${镜像?.workflowText || "-"}｜回传：${镜像?.returnText || "-"}`);
  行列表.push(`平台状态：${镜像?.platformText || "-"}`);
  行列表.push(`识别日期：${镜像?.detectedText || "未知"}`);
  if (订单.invoiceTitle) 行列表.push(`发票抬头：${订单.invoiceTitle}`);
  if (订单.invoiceAmountText || 订单.invoiceAmount) 行列表.push(`发票金额：${订单.invoiceAmountText || 订单.invoiceAmount}`);
  if (订单.invoiceCountdownText) 行列表.push(`开票倒计时：${订单.invoiceCountdownText}`);
  if (订单.assigneeName) 行列表.push(`跟进人：${订单.assigneeName}`);
  if (订单.noteText || 订单.orderNoteText) 行列表.push(`备注：${订单.noteText || 订单.orderNoteText}`);
  行列表.push("");
  行列表.push(`最近消息：${镜像?.lastMessage || "无"}`);
  if (尝试.attemptedAt) 行列表.push(`最近回传时间：${尝试.attemptedAt}`);
  if (尝试.invoiceFilePath) 行列表.push(`发票文件：${尝试.invoiceFilePath}`);
  if (尝试.screenshotPath) 行列表.push(`截图凭证：${尝试.screenshotPath}`);
  if (订单.rowText) 行列表.push("");
  if (订单.rowText) 行列表.push(`原始行：${订单.rowText}`);
  return 行列表;
}

module.exports = {
  压缩单行文本,
  规范化表格单元格文本,
  构建表头,
  构建表格行,
  计算动态列宽,
  计算表格宽度方案,
  构建订单镜像,
  构建订单镜像列表,
  订单是否需关注,
  订单是否失败,
  订单过滤模式,
  过滤订单镜像列表,
  切换订单过滤模式,
  订单表格列定义,
  构建订单表格列定义,
  构建订单表格值列表,
  构建订单表格宽度方案,
  构建订单表格头,
  构建订单表格行,
  渲染订单详情,
};
