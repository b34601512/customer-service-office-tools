module.exports = {
  // 这里控制独立转接监控轮询节奏，单位毫秒；它只拉接口看分配变化，不会像超时链路那样频繁点开会话。
  transferMonitorScanIntervalMs: 1500,

  // 这里控制漏回复监控是否启用；它独立检查“稍等/无人接后长期没有实质回复”的客户。
  missedReplyMonitorEnabled: true,

  // 这里控制无人在线提醒是否启用；它只看当前应值班客服有没有人开启自动分配。
  onlinePresenceMonitorEnabled: true,

  // 这里控制无人在线提醒扫描节奏，单位毫秒；默认 5 秒只扫状态，不直接等于提醒频率。
  onlinePresenceScanIntervalMs: 5000,

  // 这里控制无人在线提醒每天从几点开始判断早班，避免凌晨误判早班无人在线。
  onlinePresenceWorkStartTime: "08:00",

  // 这里控制是否自动帮客服打开「是否可被转接」：检测到客服开了自动分配但可被转接待关闭时自动补开，
  // 避免客服忘记开转接待导致客户无法转接给他。
  transferAutoOpenEnabled: true,

  // 这里控制是否自动帮客服关闭「是否可被转接」：检测到客服关了自动分配但可被转接待仍开启时自动关闭，
  // 避免客服不接活时别人还能转接待给他，造成客户无人回复。
  transferAutoCloseEnabled: true,

  // 这里控制统一未回复监控轮询节奏，单位毫秒；默认 5 秒一轮，全部联系人分批读取。
  missedReplyScanIntervalMs: 5000,

  // 这里控制统一未回复监控每轮最多读取多少个会话消息；默认每轮 20 个，在完整联系人范围内轮转。
  missedReplyMaxContactsPerScan: 20,

  // 这里配置客服临时回复关键词；matchMode 支持 exact(完全匹配)、startsWith(开头匹配)、includes(包含匹配)。
  // 这里命中后只算“临时接住”，不算最终实质回复，会进入漏回复长期观察。
  missedReplyTemporaryReplyKeywords: [
    { text: "稍等", matchMode: "startsWith" },
    { text: "请稍等", matchMode: "startsWith" },
    { text: "稍等一下", matchMode: "startsWith" },
    { text: "稍后回复", matchMode: "startsWith" },
    { text: "帮您看下", matchMode: "startsWith" },
    { text: "我看一下", matchMode: "startsWith" },
    { text: "我查一下", matchMode: "startsWith" },
    { text: "这边核实一下", matchMode: "startsWith" },
    { text: "这边确认一下", matchMode: "startsWith" },
    { text: "我帮您跟领导反馈一下看看吧", matchMode: "exact" }
  ],

  // 这里配置客户主动结案关键词；命中后会关闭此前仍未完成的待回复责任。
  missedReplyCustomerResolutionKeywords: [
    { text: "找到问题了", matchMode: "includes" }
  ],

  // 这里配置客户弱收尾关键词；命中后按弱收尾忽略本条消息，不关闭此前尚未完成的反馈或申请。
  // 采用包含匹配：道谢/收尾常带标点或组合（如「谢谢！知道了。」）也应识别为弱收尾，不再精确死磕。
  missedReplyCustomerClosingKeywords: [
    { text: "谢谢", matchMode: "includes" },
    { text: "好的", matchMode: "includes" },
    { text: "好", matchMode: "includes" },
    { text: "嗯", matchMode: "includes" },
    { text: "嗯嗯", matchMode: "includes" },
    { text: "嗯呢", matchMode: "includes" },
    { text: "OK", matchMode: "includes" },
    { text: "收到", matchMode: "includes" },
    { text: "好滴", matchMode: "includes" },
    { text: "抱拳", matchMode: "includes" },
    { text: "握手", matchMode: "includes" },
    { text: "玫瑰", matchMode: "includes" }
  ],

  // 这里配置无效人工回复；命中后不算实质回复，避免标点和占位符误清零。
  missedReplyInvalidAgentReplyKeywords: [
    { text: ".", matchMode: "exact" },
    { text: "。", matchMode: "exact" },
    { text: "，", matchMode: "exact" },
    { text: ",", matchMode: "exact" },
    { text: "、", matchMode: "exact" },
    { text: "...", matchMode: "exact" },
    { text: "…", matchMode: "exact" }
  ],

  // 这里配置平台固定提示过滤；命中后按系统消息排除，不算客户真实发言。
  missedReplyPlatformNoticeKeywords: [
    { text: "我已经添加了你", matchMode: "startsWith" },
    { text: "我已添加了你", matchMode: "startsWith" },
    { text: "你已添加了", matchMode: "startsWith" }
  ],

  // 这里配置客户已不是联系人时的平台拦截提示；命中后整段会话不再触发超时或漏回复。
  missedReplyUnreachableContactKeywords: [
    { text: "你还不是他（她）的联系人", matchMode: "includes" },
    { text: "你还不是他(她)的联系人", matchMode: "includes" },
    { text: "请先发送联系人验证请求，对方验证通过后，才能聊天", matchMode: "includes" }
  ],

  // 这里控制是否启用「群聊识别」：开启后联系人快照里自动剔除企微群聊会话，
  // 避免把群消息当成客户消息触发超时/漏回复/转接提醒；关闭后恢复旧行为（不推荐）。
  groupChatFilterEnabled: true,

  // 这里控制是否启用「多外部发送者=群聊」识别：单聊只会有一个外部客户发言，
  // 会话里出现两个及以上不同外部发送者时判定为群聊并跳过督办，不依赖群名带不带“群”字。
  groupChatDetectMultipleExternalSenders: true,

  // 这里配置群聊识别关键词；默认名称包含「群」即判定为群聊，
  // 覆盖 顺丰—德达查催群-深圳&湖南、退款对接群、发票沟通群 这类企微群会话，不需要逐群添加。
  groupChatFilterKeywords: [
    { text: "群", matchMode: "includes" }
  ],

  // 这里配置客户会话命名后缀；名称带该后缀的会话即使包含“群”字也按客户保留，
  // 避免把昵称带“群”字的真实客户（如 王群【客户】）误伤。
  groupChatFilterCustomerSuffix: "【客户】",

  // 这里控制客户等待多久后触发首次超时提醒；漏回复提醒固定为这个阈值的 10 倍，避免两套阈值配置打架。
  timeoutReminderThresholdSeconds: 150,

  // 这里控制下班监控是否启用；启用后会按排班动态收尾，不会对接班人做固定毫秒等待。
  offDutyAutomationEnabled: true,

  // 这里控制下班监控检查节奏，单位毫秒；默认 5 分钟，程序启动后立即检查一次。
  offDutyScanIntervalMs: 300000,

  // 这里控制不在班时自动关闭开关的判断窗口起点；不在上班时间窗内（上班前或下班后）都会静默关闭「自动分配/是否可被转接」。
  offDutyPreSalesEarlyStartTime: "08:00",
  offDutyPreSalesLateStartTime: "15:45",
  offDutyAfterSalesEarlyStartTime: "08:00",
  offDutyAfterSalesLateStartTime: "14:00",

  // 这里控制售前早班下班收尾时间。
  offDutyPreSalesEarlyCloseTime: "16:30",

  // 这里控制售前晚班下班收尾时间。
  offDutyPreSalesLateCloseTime: "23:45",

  // 这里控制售后早班下班收尾时间。
  offDutyAfterSalesEarlyCloseTime: "16:30",

  // 这里控制售后晚班下班收尾时间。
  offDutyAfterSalesLateCloseTime: "22:30",

  // 这里控制群里是否外发明天班次；默认只在后台记录，不对外提醒。
  offDutyTomorrowShiftNotificationEnabled: true
};
