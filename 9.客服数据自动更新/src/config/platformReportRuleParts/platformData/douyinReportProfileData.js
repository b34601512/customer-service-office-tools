// 该文件只保存抖音平台报表规则与官方下载来源。

const reportRules = {
  "performance": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "amount", "sourceFieldLabel": "客服询单支付额" },
        { "key": "inquiry", "sourceFieldLabel": "询单人数" },
        { "key": "order", "sourceFieldLabel": "下单人数" }
      ]
    }
  },
  "response_time": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "avg_response_time", "sourceFieldLabel": "工作时间平响时长" },
        { "key": "response_weight", "sourceFieldLabel": "接待会话量" }
      ]
    }
  },
  "three_minute_response_rate": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "three_minute_response_rate", "sourceFieldLabel": "工作时间3分钟回复率" }
      ]
    }
  },
  "customer_satisfaction": {
    "system": {
      "sourceSheetMode": "first_sheet",
      "sourceSheetName": "",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "客服账号",
      "metricMappings": [
        { "key": "satisfied_count", "sourceFieldLabel": "有效好评数" },
        { "key": "evaluation_count", "sourceFieldLabel": "有效评价数" }
      ]
    }
  }
};

const defaultSources = {
  "performance": {
    "siteUrl": "https://im.jinritemai.com/pc_seller_v2/main/data/customerService/index",
    "downloadMode": "system"
  },
  "response_time": { "siteUrl": "https://im.jinritemai.com/pc_seller_v2/main/data/customerService/index", "downloadMode": "system" },
  "three_minute_response_rate": { "siteUrl": "https://im.jinritemai.com/pc_seller_v2/main/data/customerService/index", "downloadMode": "system" },
  "customer_satisfaction": {
    "siteUrl": "https://im.jinritemai.com/pc_seller_v2/main/data/customerService/index",
    "downloadMode": "system"
  }
};

module.exports = { reportRules, defaultSources };
