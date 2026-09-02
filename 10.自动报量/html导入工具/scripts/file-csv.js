// 该文件用于读取文件、解码CSV并校验数据源字段。
function readFileAsArrayBuffer(file) {
  // 该函数用于读取客服选择的本地文件，不上传任何数据。
  return file.arrayBuffer();
}

function decodeCsvText(arrayBuffer) {
  // 该函数用于自动兼容管易导出的GB18030 CSV，避免中文字段乱码。
  const encodings = ["gb18030", "utf-8"];
  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding).decode(arrayBuffer);
      if (text.includes("店铺名称") && text.includes("付款时间")) {
        addStep(`CSV编码识别：${encoding}`, "done");
        return text;
      }
    } catch (error) {
      continue;
    }
  }
  throw new Error("CSV编码识别失败，请确认文件是管易导出的订单商品明细统计.csv。");
}

function parseCsv(text) {
  // 该函数用于解析带引号和逗号的CSV，避免金额里的千分位逗号把列拆错。
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  if (rows.length < 2) throw new Error("CSV没有可解析的数据行。");
  const headers = rows[0].map((item) => cleanCell(item).replace(/^\uFEFF/, ""));
  const records = rows.slice(1).filter((items) => items.some((item) => cleanCell(item) !== "")).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = items[index] ?? "";
    });
    return record;
  });
  return { headers, records };
}

function validateRequiredColumns(headers, config) {
  // 该函数用于提前暴露字段名错误，不让程序用空字段继续算出错数。
  const headerSet = new Set(headers);
  const required = Object.values(config.sourceColumns);
  const missing = required.filter((header) => !headerSet.has(header));
  if (missing.length > 0) {
    throw new Error(`CSV缺少字段：${missing.join("、")}。`);
  }
}
