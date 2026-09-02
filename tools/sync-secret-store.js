#!/usr/bin/env node
// 从磁盘真实配置文件重建 tools/git-secret-store.json（不入库）。
// 当店铺/人员等敏感字段变化后，重跑：node tools/sync-secret-store.js
// 数据来源是本地磁盘文件本身，因此只在本机有效，不上传。

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const STORE_PATH = path.join(__dirname, "git-secret-store.json");

// 每个被过滤文件的敏感字段清单。
// 语法：a.b.c 单字段；a.b[].c 数组逐元素；a.b[].d[] 嵌套数组；mappings.* 对象逐键。
const SPEC = {
  "9.客服数据自动更新/project-config/platform-config.json": [
    "workbook.path",
    "kdocsDataDetailSync.documentUrl",
    "kdocsDataDetailSync.syncWebhookUrl",
    "kdocsDataDetailSync.syncApiToken",
    "kdocsDataDetailSync.filterWebhookUrl",
    "kdocsDataDetailSync.filterApiToken",
    "kdocsDataDetailSync.customerServiceNameWebhookUrl",
    "kdocsDataDetailSync.customerServiceNameApiToken",
    "globalDefaults.downloadRootDir",
    "tmall.stores[].username",
    "tmall.stores[].password",
    "tmall.stores[].downloadDir",
    "jd.stores[].username",
    "jd.stores[].password",
    "jd.stores[].downloadDir",
    "pdd.stores[].username",
    "pdd.stores[].password",
    "pdd.stores[].downloadDir",
    "douyin.stores[].username",
    "douyin.stores[].password",
    "douyin.stores[].downloadDir",
    "globalDefaults.reportProfiles.performance.personMappings[].summaryName",
    "globalDefaults.reportProfiles.performance.personMappings[].sourceNames[]"
  ],
  "12.店铺指标数据自动更新/project-config/platform-config.json": [
    "workbook.path",
    "kdocsDataSourceSync.documentUrl",
    "kdocsDataSourceSync.webhookUrl",
    "kdocsDataSourceSync.apiToken",
    "jd.stores[].username",
    "jd.stores[].password",
    "jd.stores[].downloadDir",
    "tmall.stores[].username",
    "tmall.stores[].password",
    "tmall.stores[].downloadDir",
    "pdd.stores[].username",
    "pdd.stores[].password",
    "pdd.stores[].downloadDir",
    "douyin.stores[].username",
    "douyin.stores[].password",
    "douyin.stores[].downloadDir",
    "douyin.stores[].platformStoreId",
    "douyin.stores[].platformStoreName"
  ],
  "5.电话漏接分析/电话漏接分析后台/download_config.json": [
    "baseUrl",
    "companyCode",
    "account",
    "password",
    "downloadDir",
    "profileDir"
  ],
  "5.电话漏接分析/电话漏接分析后台/agent_mapping.json": [
    "mappings.*"
  ],
  "5.电话漏接分析/电话漏接分析后台/complaint_config.json": [
    "receiverPhones[]",
    "receiverExtensions[]",
    "receiverPhone",
    "receiverExtension"
  ]
};

function tokenize(pattern) {
  const re = /([A-Za-z_$][\w$]*)|(\[\])|\[(\d+)\]|(\.\*)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(pattern))) {
    if (m[1]) tokens.push({ type: "key", value: m[1] });
    else if (m[2]) tokens.push({ type: "iterate" });
    else if (m[3]) tokens.push({ type: "index", value: Number(m[3]) });
    else if (m[4]) tokens.push({ type: "iterate" });
  }
  return tokens;
}

function expandTokens(tokens, obj, pathSoFar, out) {
  if (!tokens.length) {
    out.push(pathSoFar);
    return;
  }
  const t = tokens[0];
  if (t.type === "iterate") {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        expandTokens(tokens.slice(1), obj[i], `${pathSoFar}[${i}]`, out);
      }
    } else if (obj && typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        const escaped = k.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        expandTokens(tokens.slice(1), obj[k], `${pathSoFar}["${escaped}"]`, out);
      }
    }
    return;
  }
  const key = t.value;
  const suffix = t.type === "index" ? `[${key}]` : `.${key}`;
  expandTokens(tokens.slice(1), obj == null ? undefined : obj[key], pathSoFar + suffix, out);
}

function expandPattern(obj, pattern) {
  const out = [];
  expandTokens(tokenize(pattern), obj, "", out);
  return out;
}

function main() {
  if (fs.existsSync(STORE_PATH)) {
    // 保留备份，方便回滚
    fs.copyFileSync(STORE_PATH, STORE_PATH + ".bak");
  }
  const store = {};
  for (const [relFile, patterns] of Object.entries(SPEC)) {
    const absFile = path.join(ROOT, relFile);
    if (!fs.existsSync(absFile)) {
      console.log(`[skip] ${relFile} 不存在`);
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(absFile, "utf8"));
    } catch (err) {
      console.log(`[skip] ${relFile} 不是合法 JSON`);
      continue;
    }
    const fields = [];
    for (const pattern of patterns) {
      for (const concretePath of expandPattern(obj, pattern)) {
        const value = getByConcrete(concretePath, obj);
        if (value === undefined || (typeof value === "string" && value === "")) continue;
        fields.push({ path: concretePath, value });
      }
    }
    if (relFile.endsWith("agent_mapping.json")) {
      // 手机号形式的键也属于个人隐私：转成键名打码字段
      let phoneCount = 0;
      const masked = [];
      for (const f of fields) {
        const key = (f.path.match(/\["((?:[^"\\]|\\.)*)"\]$/) || [])[1];
        if (key && /^1[3-9]\d{9}$/.test(key)) {
          phoneCount += 1;
          masked.push({ path: f.path, keyMask: `员工手机号_${phoneCount}`, value: f.value });
        } else {
          masked.push(f);
        }
      }
      fields.splice(0, fields.length, ...masked);
    }
    if (fields.length) store[relFile] = { fields };
    console.log(`[ok] ${relFile}: ${fields.length} 个敏感字段`);
  }
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
  console.log("已写入", STORE_PATH);
}

function getByConcrete(expr, obj) {
  const re = /([A-Za-z_$][\w$]*)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\]/g;
  let cur = obj;
  let m;
  while ((m = re.exec(expr))) {
    if (cur == null) return undefined;
    if (m[1]) cur = cur[m[1]];
    else if (m[2]) cur = cur[Number(m[2])];
    else cur = cur[m[3].replace(/\\(["\\])/g, "$1")];
  }
  return cur;
}

main();