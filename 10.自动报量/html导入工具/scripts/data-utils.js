// 该文件用于处理时间、数字、文本清洗、深拷贝和格式化。
function parsePaymentTime(text) {
  // 该函数用于严格解析付款时间，避免浏览器用不同地区格式误判日期。
  const value = cleanCell(text);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
}

function resolveDateAndShift(date, config) {
  // 该函数用于按付款时间拆成业务日期和白班/夜班。
  const dateText = formatLocalDate(date);
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  const dayEndMinutes = parseClockMinutes(config.shift.dayEnd || "16:00");
  return {
    date: dateText,
    shift: minutes <= dayEndMinutes ? "day" : "night",
  };
}

function parseClockMinutes(text) {
  // 该函数用于把HH:mm转换成分钟数，让班次边界集中控制。
  const [hour, minute] = String(text || "16:00").split(":").map(Number);
  return hour * 60 + (minute || 0);
}

function parsePrice(productName) {
  // 该函数用于从产品名里的括号价格计算销售额，保持和原报量表逻辑一致。
  const match = String(productName || "").match(/（([0-9,.]+)元）/);
  return match ? parseNumber(match[1]) : 0;
}

function excelSerialToDate(serial) {
  // 该函数用于把Excel日期序列号转换成yyyy-mm-dd。
  const milliseconds = Math.round((serial - 25569) * 86400000);
  return formatUtcDate(new Date(milliseconds));
}

function buildMappingKey(storeName, materialCode) {
  // 该函数用于统一映射键，避免空格和制表符造成匹配失败。
  return `${cleanCell(storeName)}||${cleanCell(materialCode)}`;
}

function cleanCell(value) {
  // 该函数用于清理管易CSV里常见的制表符和多余空白。
  return String(value ?? "").replace(/\t/g, "").trim();
}

function parseNumber(value) {
  // 该函数用于解析数量和金额，兼容CSV里的千分位逗号。
  const text = cleanCell(value).replace(/,/g, "");
  if (text === "") return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function splitLines(text) {
  // 该函数用于把配置面板中的多行文本转为去重数组。
  return [...new Set(String(text || "").split(/\r?\n/).map(cleanCell).filter(Boolean))];
}

function cloneData(value) {
  // 该函数用于兼容旧浏览器深拷贝纯配置对象，避免 structuredClone 不存在导致页面报错。
  return JSON.parse(JSON.stringify(value));
}

function increaseMapCount(map, key, amount) {
  // 该函数用于累加统计计数或数量。
  map.set(key, (map.get(key) || 0) + amount);
}

function rememberExample(list, text, limit) {
  // 该函数用于保留少量异常样例，避免页面日志刷屏。
  if (list.length < limit && !list.includes(text)) list.push(text);
}

function getElementsByLocalName(documentOrElement, localName) {
  // 该函数用于忽略XML命名空间读取节点，兼容Excel生成的不同前缀。
  return [...documentOrElement.getElementsByTagName("*")].filter((item) => item.localName === localName);
}

function yieldToUi() {
  // 该函数用于把控制权还给浏览器刷新界面，避免进度条不动。
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function formatLocalDate(date) {
  // 该函数用于按本地时区格式化日期，避免UTC导致日期前后错一天。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateOnly(dateText) {
  // 该函数用于把yyyy-mm-dd解析成本地日期，避免浏览器把它当UTC日期。
  const [year, month, day] = String(dateText || "").split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

function describeImportRange(targetDate, mode) {
  // 该函数用于生成页面日志里的导入范围说明。
  if (mode === "day") return targetDate;
  if (mode === "monthToToday") return `${targetDate.slice(0, 8)}01 至 ${targetDate}`;
  return `${targetDate.slice(0, 7)}整月`;
}

function formatUtcDate(date) {
  // 该函数用于把Excel序列号日期格式化成yyyy-mm-dd。
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatNumber(number) {
  // 该函数用于统一显示整数和少量小数，不让页面出现长尾浮点数。
  const rounded = Math.round((Number(number) || 0) * 10000) / 10000;
  return rounded.toLocaleString("zh-CN");
}

function formatRawNumber(number) {
  // 该函数用于写入Excel内部数字，避免千分位逗号被当成文本。
  const rounded = Math.round((Number(number) || 0) * 10000) / 10000;
  return String(rounded);
}
