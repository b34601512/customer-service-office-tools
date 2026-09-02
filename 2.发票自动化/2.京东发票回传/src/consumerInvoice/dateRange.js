const 默认申请时间最近天数 = 30;

function 规范化申请时间最近天数(value) {
  // 解决：接口查询仍保留“最近 N 天”业务边界，避免无意中全量扫历史订单。
  const numberValue = Number.parseInt(value, 10);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 默认申请时间最近天数;
}

function 格式化本地日期(date) {
  // 解决：京东接口使用本地日期字符串，不能被 ISO 时区转换带偏一天。
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function 计算申请时间范围(最近天数 = 默认申请时间最近天数, 当前时间 = new Date()) {
  // 解决：把配置的最近天数集中换算成接口需要的申请时间范围。
  const days = 规范化申请时间最近天数(最近天数);
  const 结束日期 = new Date(当前时间.getFullYear(), 当前时间.getMonth(), 当前时间.getDate());
  const 开始日期 = new Date(结束日期);
  开始日期.setDate(开始日期.getDate() - days);
  return {
    days,
    startDate: 格式化本地日期(开始日期),
    endDate: 格式化本地日期(结束日期),
  };
}

function 解析日期字符串(dateString) {
  // 解决：接口 ISO 时间必须从 yyyy-MM-dd 显式解析，避免浏览器和 Node 对短日期解析不一致。
  const 匹配结果 = String(dateString || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!匹配结果) {
    throw new Error(`申请时间日期格式错误：${dateString}`);
  }
  return {
    year: Number(匹配结果[1]),
    month: Number(匹配结果[2]),
    day: Number(匹配结果[3]),
  };
}

function 转京东接口ISO时间(dateString, 是否结束时间 = false) {
  // 解决：京东页面按中国时区提交 waitApplyTime，这里直接生成等价 UTC ISO。
  const { year, month, day } = 解析日期字符串(dateString);
  const utcTime = 是否结束时间
    ? Date.UTC(year, month - 1, day, 15, 59, 59, 999)
    : Date.UTC(year, month - 1, day, -8, 0, 0, 0);
  return new Date(utcTime).toISOString();
}

function 构建申请时间接口字段(日期范围) {
  // 解决：接口请求体只在这里补申请时间字段，避免调用方手写多个日期字段造成不一致。
  return {
    applyTimeStart: `${日期范围.startDate} 00:00:00`,
    applyTimeEnd: `${日期范围.endDate} 23:59:59`,
    waitApplyTime: [
      转京东接口ISO时间(日期范围.startDate, false),
      转京东接口ISO时间(日期范围.endDate, true),
    ],
  };
}

module.exports = {
  默认申请时间最近天数,
  计算申请时间范围,
  构建申请时间接口字段,
  转京东接口ISO时间,
};
