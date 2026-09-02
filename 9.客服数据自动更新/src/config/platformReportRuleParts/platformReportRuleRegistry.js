// 该文件只负责汇总四个平台独立的报表规则数据。

const tmallData = require("./platformData/tmallReportProfileData");
const jdData = require("./platformData/jdReportProfileData");
const pddData = require("./platformData/pddReportProfileData");
const douyinData = require("./platformData/douyinReportProfileData");

const REPORT_RULE_BY_PLATFORM_REPORT_AND_DOWNLOAD_MODE = { tmall: tmallData.reportRules, jd: jdData.reportRules, pdd: pddData.reportRules, douyin: douyinData.reportRules };
const DEFAULT_SOURCE_BY_PLATFORM_REPORT = { tmall: tmallData.defaultSources, jd: jdData.defaultSources, pdd: pddData.defaultSources, douyin: douyinData.defaultSources };

module.exports = { REPORT_RULE_BY_PLATFORM_REPORT_AND_DOWNLOAD_MODE, DEFAULT_SOURCE_BY_PLATFORM_REPORT };

