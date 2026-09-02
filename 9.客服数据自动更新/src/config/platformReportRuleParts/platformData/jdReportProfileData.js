// 该文件只保存京东平台报表规则与官方下载来源。

const reportRules = {
  "performance": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "整体数据",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服",
      "metricMappings": [
        { "key": "amount", "sourceFieldLabel": "促成下单商品金额" },
        { "key": "inquiry", "sourceFieldLabel": "售前接待人数" },
        { "key": "order", "sourceFieldLabel": "促成下单人数" }
      ]
    }
  },
  "response_time": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "整体数据",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服",
      "metricMappings": [
        { "key": "avg_response_time", "sourceFieldLabel": "平均响应时长（新）" },
        { "key": "response_weight", "sourceFieldLabel": "接待量" },
        { "key": "thirty_second_response_rate", "sourceFieldLabel": "30s应答率" }
      ]
    }
  },
  "three_minute_response_rate": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "整体数据",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服",
      "metricMappings": [
        { "key": "three_minute_response_rate", "sourceFieldLabel": "客服3分钟人工回复率" }
      ]
    }
  },
  "customer_satisfaction": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "整体数据",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服",
      "metricMappings": [
        { "key": "satisfied_count", "sourceFieldLabel": "好评量" },
        { "key": "evaluation_count", "sourceFieldLabel": "评价量" }
      ]
    }
  }
};

const defaultSources = {
  "performance": {
    "siteUrl": "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData",
    "downloadMode": "system"
  },
  "response_time": {
    "siteUrl": "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData",
    "downloadMode": "system"
  },
  "three_minute_response_rate": {
    "siteUrl": "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData",
    "downloadMode": "system"
  },
  "customer_satisfaction": {
    "siteUrl": "https://xi.jd.com/kf-manage-lite/#/DataAnalysis/ReceptionData",
    "downloadMode": "system"
  }
};

module.exports = { reportRules, defaultSources };
