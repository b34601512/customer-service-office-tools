// 该文件只保存拼多多平台报表规则与官方下载来源。

const reportRules = {
  "performance": {
    "system": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "Sheet0",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "amount", "sourceFieldLabel": "去退销售额（元）" },
        { "key": "inquiry", "sourceFieldLabel": "询单人数" },
        { "key": "order", "sourceFieldLabel": "最终成团人数" }
      ]
    }
  },
  "response_time": {
    "system": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "Sheet0",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "avg_response_time", "sourceFieldLabel": "平均人工响应时长" },
        { "key": "response_weight", "sourceFieldLabel": "需要人工回复的咨询人数" },
        { "key": "thirty_second_response_rate", "sourceFieldLabel": "30秒应答率(8-23点)" }
      ]
    }
  },
  "three_minute_response_rate": {
    "system": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "Sheet0",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "three_minute_response_rate", "sourceFieldLabel": "3分钟人工回复率(8-23点)" },
        { "key": "three_minute_unreplied_count", "sourceFieldLabel": "3分钟未回复人数" }
      ]
    }
  }
};

const defaultSources = {
  "performance": {
    "siteUrl": "https://mms.pinduoduo.com/mms-chat/overview/merchant",
    "downloadMode": "system"
  },
  "response_time": {
    "siteUrl": "https://mms.pinduoduo.com/mms-chat/overview/merchant",
    "downloadMode": "system"
  },
  "three_minute_response_rate": {
    "siteUrl": "https://mms.pinduoduo.com/mms-chat/overview/merchant",
    "downloadMode": "system"
  }
};

module.exports = { reportRules, defaultSources };
