// 该文件只保存天猫平台报表规则与官方下载来源。

const reportRules = {
  "performance": {
    "sycm": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "数据信息",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "旺旺昵称",
      "metricMappings": [
        { "key": "amount", "sourceFieldLabel": "净销售额" },
        { "key": "inquiry", "sourceFieldLabel": "询单人数" },
        { "key": "order", "sourceFieldLabel": "下单人数" }
      ]
    }
  },
  "response_time": {
    "single_file": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "按客服查看",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "旺旺账号名称",
      "metricMappings": [
        { "key": "avg_response_time", "sourceFieldLabel": "平均响应时长" },
        { "key": "response_weight", "sourceFieldLabel": "人工接待会话量" }
      ]
    }
  },
  "three_minute_response_rate": {
    "single_file": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "按客服查看",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "旺旺账号名称",
      "metricMappings": [
        { "key": "three_minute_response_rate", "sourceFieldLabel": "3分钟人工响应率" }
      ]
    }
  },
  "customer_satisfaction": {
    "single_file": {
      "sourceSheetMode": "single_sheet",
      "sourceSheetName": "旺旺账号咨询接待能力明细",
      "sourceSheetIndex": 0,
      "sourceAliasFieldLabel": "旺旺账号名称",
      "metricMappings": [
        { "key": "satisfied_count", "sourceFieldLabel": "满意评价量" },
        { "key": "evaluation_count", "sourceFieldLabel": "旺旺评价量" }
      ]
    }
  }
};

const defaultSources = {
  "performance": {
    "siteUrl": "https://sycm.taobao.com/qos/service/frame/customer/performance/new#/user",
    "downloadMode": "sycm"
  },
  "response_time": {
    "siteUrl": "https://qn.taobao.com/home.html/voc-tmall/serverReport",
    "downloadMode": "single_file"
  },
  "three_minute_response_rate": {
    "siteUrl": "https://qn.taobao.com/home.html/voc-tmall/serverReport",
    "downloadMode": "single_file"
  },
  "customer_satisfaction": {
    "siteUrl": "https://qn.taobao.com/home.html/voc-tmall/serverReport",
    "downloadMode": "single_file"
  }
};

module.exports = { reportRules, defaultSources };
