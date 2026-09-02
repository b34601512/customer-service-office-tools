const path = require('path');
const { 执行巡检 } = require('../../app/checkInvoiceUrges');
const { 执行批量发票回传 } = require('../../app/returnInvoiceToJd');
const { 关闭全部浏览器上下文 } = require('../../browser/browserContextHub');
const { 打印日志 } = require('../../common/logger');
const { 读取店铺配置, 获取启用店铺列表 } = require('../../store/storeConfigService');
const {
  更新店铺结果,
  更新最近批量摘要,
  更新最近单店摘要,
} = require('../../store/storeResultService');
const {
  读取订单记录,
  记录转列表,
  是平台待开票待回传订单,
} = require('../../order/jdOrderRecordStore');
const {
  创建凭证批次目录,
  构建店铺凭证路径,
} = require('../../common/evidenceService');
const { 批量单店最大尝试次数, 批量店铺页面保留模式, 批量回传页面保留模式 } = require('./taskConstants');
const { 是需要自动拉起登录的错误 } = require('./loginError');
const {
  构建失败店铺结果,
  构建等待店铺结果,
  构建运行中店铺结果,
  构建分页进度店铺结果,
  构建等待登录店铺结果,
  构建成功店铺结果,
} = require('./storeResultFactory');
const {
  创建批量统计,
  记录成功店铺,
  记录失败店铺,
  记录店铺结果,
  构建批量摘要,
  构建单店摘要,
  构建批量完成消息,
} = require('./batchSummary');
const 发票回传状态标签 = {
  queued: '等待中',
  downloading: '下载中',
  downloaded: '已下载',
  uploading: '上传中',
  success: '成功',
  skipped: '已跳过',
  error: '失败',
};

class ControlCenterTaskService {
  constructor(state, 依赖 = {}) {
    // 解决：任务服务只负责调度依赖，具体识别、结果保存和状态推送由独立函数完成。
    const 是否测试运行 = process.env.JD_INVOICE_URGE_TEST_MODE === '1'
      || process.argv.includes('--test')
      || Boolean(process.env.NODE_TEST_CONTEXT);
    this.state = state;
    this.执行巡检方法 = 依赖.执行巡检方法 || 执行巡检;
    this.执行批量发票回传方法 = 依赖.执行批量发票回传方法 || 执行批量发票回传;
    this.关闭浏览器上下文方法 = 依赖.关闭浏览器上下文方法 || 关闭全部浏览器上下文;
    this.读取店铺配置方法 = 依赖.读取店铺配置方法 || 读取店铺配置;
    this.获取启用店铺列表方法 = 依赖.获取启用店铺列表方法 || 获取启用店铺列表;
    this.更新店铺结果方法 = 依赖.更新店铺结果方法
      || (是否测试运行 ? () => {} : 更新店铺结果);
    this.更新最近批量摘要方法 = 依赖.更新最近批量摘要方法
      || (是否测试运行 ? () => {} : 更新最近批量摘要);
    this.更新最近单店摘要方法 = 依赖.更新最近单店摘要方法
      || (是否测试运行 ? () => {} : 更新最近单店摘要);
    this.创建凭证批次目录方法 = 依赖.创建凭证批次目录方法
      || ((选项) => 是否测试运行 ? '' : 创建凭证批次目录(选项));
    this.构建店铺凭证路径方法 = 依赖.构建店铺凭证路径方法 || 构建店铺凭证路径;
    this.读取订单记录方法 = 依赖.读取订单记录方法
      || (是否测试运行 ? () => ({ version: 2, orders: {} }) : 读取订单记录);
    this.记录转列表方法 = 依赖.记录转列表方法 || 记录转列表;
    this.running = false;
    this.currentTaskPromise = null;
    this.shutdownReason = '';
  }

  async shutdownAllRunningTasks(reason = 'CLI退出') {
    // 解决：控制台退出时统一停止任务并关闭项目打开的所有浏览器上下文。
    this.shutdownReason = String(reason || 'CLI退出');
    if (this.running) {
      this.state.setTask({
        ...(this.state.currentTask || {}),
        status: 'stopping',
        label: '正在退出',
        message: '正在关闭已打开的浏览器窗口，请稍候。',
      });
    }

    await this.关闭浏览器上下文方法();

    if (this.currentTaskPromise) {
      await this.currentTaskPromise;
    }

    this.shutdownReason = '';
  }

  启动单店排查(storeId) {
    // 解决：单店按钮只启动指定店铺，人工核对窗口保持到用户关闭。
    this.#启动任务(`single:${storeId}`, async () => {
      const 店铺 = this.读取店铺配置方法().stores.find((当前店铺) => 当前店铺.id === storeId);
      if (!店铺) {
        throw new Error(`未找到店铺：${storeId}`);
      }

      const 开始时间 = new Date().toISOString();
      const 凭证批次目录 = this.创建凭证批次目录方法({
        执行类型: '单店识别',
        开始时间,
      });
      try {
        const 店铺结果 = await this.#执行单店巡检(店铺, {
          可见模式: true,
          页面保留模式: 'wait',
          开始时间,
          凭证批次目录,
          截图场景: '人工登录',
        });
        this.#保存单店摘要({
          开始时间,
          完成时间: new Date().toISOString(),
          店铺,
          店铺结果,
        });
        return { message: `单店识别完成：${店铺.name}` };
      } catch (错误) {
        this.#保存单店摘要({
          开始时间,
          完成时间: new Date().toISOString(),
          店铺,
          店铺结果: 构建失败店铺结果(店铺, 错误),
        });
        throw 错误;
      }
    });
  }

  启动全部排查() {
    // 解决：全部识别只按启用店铺串行执行，不并发打开多个浏览器档案。
    this.#启动任务('all', async () => {
      const 店铺列表 = this.获取启用店铺列表方法();
      if (店铺列表.length === 0) {
        throw new Error('当前没有启用中的店铺，请先在后台保存店铺配置。');
      }

      return this.#执行店铺列表排查(店铺列表, '全部店铺识别');
    });
  }

  启动待开票发票批量回传() {
    // 解决：批量回传按京东后台“待开票”状态筛选，不再要求本地人工登记“发票已登记”。
    this.#启动任务('invoice-return:pending-batch', async () => {
      const 配置 = this.读取店铺配置方法();
      const 订单列表 = this.记录转列表方法(this.读取订单记录方法());
      const 待回传数量 = 订单列表.filter(是平台待开票待回传订单).length;
      if (待回传数量 === 0) {
        throw new Error('批量发票回传失败：当前没有京东后台“待开票且未回传”的订单。');
      }

      const 开始时间 = new Date().toISOString();
      const 凭证批次目录 = this.创建凭证批次目录方法({
        执行类型: '发票回传',
        开始时间,
      });
      this.#初始化发票回传报告(订单列表);
      this.state.setTask({
        ...(this.state.currentTask || {}),
        status: 'running',
        label: '批量回传',
        message: `正在通过下载中心获取并回传 ${待回传数量} 张待开票发票，京东页面将保持打开供核对。`,
      });
      try {
        const 回传结果 = await this.执行批量发票回传方法({
          orders: 订单列表,
          stores: 配置.stores || [],
          headless: false,
          页面保留模式: 批量回传页面保留模式,
          凭证批次目录,
          onProgress: (进度) => this.#更新发票回传报告(进度),
        });
        this.state.setOrderRecords(this.记录转列表方法(this.读取订单记录方法()));
        this.#完成发票回传报告(回传结果.message);
        return { message: 回传结果.message };
      } catch (错误) {
        this.#标记发票回传报告失败(错误);
        throw 错误;
      }
    });
  }

  #筛选待回传订单(订单列表) {
    // 解决：报告清单和真实回传入口使用同一批“京东后台待开票且未回传”订单口径。
    return (Array.isArray(订单列表) ? 订单列表 : []).filter(是平台待开票待回传订单);
  }

  #构建发票回传报告行(order, status = 'queued', message = '等待开始回传。') {
    // 解决：单行报告只保存展示需要的订单身份和当前状态。
    return {
      key: String(order?.key || '').trim(),
      storeId: String(order?.storeId || '').trim(),
      storeName: String(order?.storeName || '').trim(),
      orderNumber: String(order?.orderNumber || '').trim(),
      status,
      statusLabel: 发票回传状态标签[status] || status,
      message,
      invoiceFilePath: String(order?.invoiceFilePath || ''),
      screenshotPath: String(order?.screenshotPath || order?.invoiceReturnScreenshotPath || ''),
      updatedAt: new Date().toISOString(),
    };
  }

  #统计发票回传报告(items) {
    // 解决：报告摘要直接从行状态计算，避免总数和表格不一致。
    return (Array.isArray(items) ? items : []).reduce((counts, item) => {
      counts.totalCount += 1;
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    }, { totalCount: 0 });
  }

  #发布发票回传报告(report) {
    // 解决：测试桩没有报告能力时跳过，不影响任务调度本身。
    if (typeof this.state.setInvoiceReturnReport === 'function') {
      this.state.setInvoiceReturnReport(report);
    }
  }

  #初始化发票回传报告(订单列表) {
    // 解决：点击按钮后立即看到本轮所有待回传订单，不等下载中心返回。
    const items = this.#筛选待回传订单(订单列表)
      .map((order) => this.#构建发票回传报告行(order));
    this.#发布发票回传报告({
      status: 'running',
      summaryMessage: `准备回传 ${items.length} 张待开票发票。`,
      ...this.#统计发票回传报告(items),
      items,
      updatedAt: new Date().toISOString(),
    });
  }

  #查找发票回传报告行索引(items, item) {
    // 解决：优先按订单 key 更新报告行，兼容只有订单号的下载中心结果。
    const key = String(item?.key || '').trim();
    const orderNumber = String(item?.orderNumber || '').trim();
    return items.findIndex((row) => (key && row.key === key) || (orderNumber && row.orderNumber === orderNumber));
  }

  #更新发票回传报告行(items, progress) {
    // 解决：单次进度事件只更新对应订单行，其他订单保持原状态。
    const index = this.#查找发票回传报告行索引(items, progress.item);
    if (index < 0) return items;
    const nextItems = items.slice();
    nextItems[index] = {
      ...nextItems[index],
      ...this.#构建发票回传报告行({
        ...nextItems[index],
        ...progress.item,
      }, progress.status, progress.message),
      updatedAt: progress.updatedAt || new Date().toISOString(),
    };
    return nextItems;
  }

  #更新发票回传报告(progress = {}) {
    // 解决：把业务流程进度转换成前端可直接渲染的逐单报告。
    if (typeof this.state.setInvoiceReturnReport !== 'function') return;
    const 当前报告 = this.state.invoiceReturnReport || { items: [] };
    if (progress.type === 'init') {
      const items = (progress.items || []).map((item) => this.#构建发票回传报告行(item));
      this.#发布发票回传报告({
        status: 'running',
        summaryMessage: progress.message || `准备回传 ${items.length} 张待开票发票。`,
        ...this.#统计发票回传报告(items),
        items,
        updatedAt: progress.updatedAt || new Date().toISOString(),
      });
      return;
    }

    if (progress.type === 'item') {
      const items = this.#更新发票回传报告行(当前报告.items || [], progress);
      this.#发布发票回传报告({
        status: progress.status === 'error' ? 'error' : 'running',
        summaryMessage: progress.message || 当前报告.summaryMessage || '',
        ...this.#统计发票回传报告(items),
        items,
        updatedAt: progress.updatedAt || new Date().toISOString(),
      });
      return;
    }

    if (progress.type === 'finish') {
      this.#完成发票回传报告(progress.message || '批量发票回传完成。');
    }
  }

  #完成发票回传报告(message) {
    // 解决：任务完成时把报告摘要切到成功，但保留每一行的最终状态。
    if (typeof this.state.setInvoiceReturnReport !== 'function') return;
    const items = this.state.invoiceReturnReport?.items || [];
    this.#发布发票回传报告({
      status: 'success',
      summaryMessage: message,
      ...this.#统计发票回传报告(items),
      items,
      updatedAt: new Date().toISOString(),
    });
  }

  #标记发票回传报告失败(错误) {
    // 解决：任务失败时报告顶层变红，已经成功或失败的单行状态不被抹掉。
    if (typeof this.state.setInvoiceReturnReport !== 'function') return;
    const items = this.state.invoiceReturnReport?.items || [];
    this.#发布发票回传报告({
      status: 'error',
      summaryMessage: `批量发票回传失败：${错误.message}`,
      ...this.#统计发票回传报告(items),
      items,
      updatedAt: new Date().toISOString(),
    });
  }

  #启动任务(taskName, runner) {
    // 解决：任务启动只负责并发门禁和最终任务状态收口。
    if (this.running) {
      throw new Error('当前已有后台任务在运行，请等待当前任务结束。');
    }

    this.running = true;
    this.state.setTask({
      taskName,
      status: 'running',
      label: '运行中',
      message: `任务已启动：${taskName}`,
      startedAt: new Date().toISOString(),
    });

    this.currentTaskPromise = Promise.resolve()
      .then(runner)
      .then((任务结果) => this.#标记任务完成(taskName, 任务结果))
      .catch((错误) => this.#标记任务失败(taskName, 错误))
      .finally(() => {
        this.running = false;
        this.currentTaskPromise = null;
      });
  }

  #标记任务完成(taskName, 任务结果) {
    // 解决：任务成功和主动停止共用一个状态出口。
    const 已请求停止 = Boolean(this.shutdownReason);
    this.state.setTask({
      taskName,
      status: 'idle',
      label: '空闲中',
      message: 已请求停止 ? `任务已停止：${taskName}` : (任务结果?.message || `任务完成：${taskName}`),
      finishedAt: new Date().toISOString(),
    });
  }

  #标记任务失败(taskName, 错误) {
    // 解决：任务失败只在一个出口写状态和日志。
    const 已请求停止 = Boolean(this.shutdownReason);
    this.state.setTask({
      taskName,
      status: 已请求停止 ? 'idle' : 'error',
      label: 已请求停止 ? '空闲中' : '失败',
      message: 已请求停止 ? `任务已停止：${taskName}` : `任务失败：${错误.message}`,
      errorMessage: 已请求停止 ? '' : String(错误.message || 错误),
      failedAt: new Date().toISOString(),
    });
    if (已请求停止) {
      打印日志('后台任务', '控制台', `任务已停止：${taskName}`);
      return;
    }
    打印日志('后台任务', '控制台', `任务失败：${错误.message}`);
  }

  async #执行店铺列表排查(店铺列表, 任务名称) {
    // 解决：批量识别串行跑店铺，浏览器保持可见并保留每个店铺窗口，便于人工核对；退出程序时才统一关闭。
    const 开始时间 = new Date().toISOString();
    const 凭证批次目录 = this.创建凭证批次目录方法({
      执行类型: '批量识别',
      开始时间,
    });
    打印日志('后台任务', 任务名称, `本轮店铺 ${店铺列表.length} 个：${店铺列表.map((店铺) => 店铺.name).join('、')}`);
    店铺列表.forEach((店铺) => {
      this.state.updateStoreResult(构建等待店铺结果(店铺));
    });

    const 统计 = 创建批量统计(店铺列表.length, 开始时间);
    for (const [索引, 店铺] of 店铺列表.entries()) {
      if (this.shutdownReason) {
        打印日志('后台任务', 任务名称, `收到退出信号，停止继续识别；已完成 ${索引}/${店铺列表.length} 家`);
        break;
      }
      await this.#执行批量单店(店铺, 索引, 店铺列表.length, 任务名称, 统计, {
        开始时间,
        凭证批次目录,
      });
    }

    const 完成时间 = new Date().toISOString();
    const 摘要 = 构建批量摘要({
      开始时间,
      完成时间,
      店铺列表,
      店铺结果列表: 统计.storeResults,
      订单列表: this.记录转列表方法(this.读取订单记录方法()),
    });
    this.更新最近批量摘要方法(摘要);
    if (typeof this.state.setBatchSummary === 'function') {
      this.state.setBatchSummary(摘要);
    }
    return {
      message: 构建批量完成消息(统计, 任务名称),
      summary: 摘要,
    };
  }

  async #执行批量单店(店铺, 索引, 总数, 任务名称, 统计, 凭证选项 = {}) {
    // 解决：单个批量店铺独立负责重试，避免批量主循环塞满细节。
    const 进度文本 = `第 ${索引 + 1}/${总数} 家`;
    let 店铺已成功 = false;
    let 最后错误 = null;
    let 店铺结果 = null;
    for (let 尝试次数 = 1; 尝试次数 <= 批量单店最大尝试次数; 尝试次数 += 1) {
      const 尝试文本 = `第 ${尝试次数}/${批量单店最大尝试次数} 次`;
      const 执行进度文本 = `${进度文本} ${尝试文本}`;
      打印日志('后台任务', 任务名称, `${执行进度文本}开始：${店铺.name}`);
      try {
        店铺结果 = await this.#执行单店巡检(店铺, {
          可见模式: true,
          页面保留模式: 批量店铺页面保留模式,
          批量进度文本: 执行进度文本,
          ...凭证选项,
          尝试次数,
          截图场景: '批量识别',
        });
        记录成功店铺(统计);
        记录店铺结果(统计, 店铺结果);
        店铺已成功 = true;
        打印日志('后台任务', 任务名称, `${执行进度文本}完成：${店铺.name}`);
        break;
      } catch (错误) {
        最后错误 = 错误;
        if (尝试次数 < 批量单店最大尝试次数 && !this.shutdownReason) {
          打印日志('后台任务', 任务名称, `${执行进度文本}失败，准备重试：${店铺.name}；原因=${错误.message}`);
          continue;
        }
        break;
      }
    }

    if (!店铺已成功) {
      记录失败店铺(统计, 店铺, 最后错误);
      店铺结果 = 构建失败店铺结果(店铺, 最后错误);
      记录店铺结果(统计, 店铺结果);
      打印日志('后台任务', 任务名称, `${进度文本}失败但继续后续店铺：${店铺.name}；原因=${最后错误?.message || '未知错误'}`);
    }
    return 店铺结果;
  }

  async #执行单店巡检(店铺, 选项 = {}) {
    // 解决：单店识别只负责状态推送、巡检调用和结果落盘。
    const {
      可见模式 = false,
      页面保留模式 = 可见模式 ? 'wait' : 'close',
      批量进度文本 = '',
      开始时间 = new Date().toISOString(),
      凭证批次目录 = '',
      尝试次数 = 1,
      截图场景 = 可见模式 ? '人工登录' : '批量识别',
    } = 选项;
    const 店铺展示名 = 批量进度文本 ? `${批量进度文本}「${店铺.name}」` : `「${店铺.name}」`;

    this.#推送单店运行状态(店铺, 店铺展示名, 可见模式);
    打印日志('后台任务', '控制台', `开始识别店铺：${店铺.name}`);
    const 巡检结果 = await this.#执行带登录恢复的巡检(店铺, {
      可见模式,
      页面保留模式,
      开始时间,
      凭证批次目录,
      尝试次数,
      截图场景,
      onProgress: (进度) => this.#推送分页读取状态(店铺, 店铺展示名, 可见模式, 进度),
    });
    const 店铺结果 = 构建成功店铺结果(店铺, 巡检结果);
    this.更新店铺结果方法(店铺结果);
    this.state.updateStoreResult(店铺结果);
    this.state.setOrderRecords(this.记录转列表方法(this.读取订单记录方法()));
    打印日志('后台任务', '控制台', `店铺识别完成：${店铺.name}`);
    return 店铺结果;
  }

  #推送单店运行状态(店铺, 店铺展示名, 可见模式) {
    // 解决：任务摘要和巡检报告运行状态集中同步。
    this.state.setTask({
      ...(this.state.currentTask || {}),
      status: 'running',
      label: '运行中',
      message: 可见模式
        ? `正在为${店铺展示名}打开可见浏览器并识别催票订单。`
        : `正在后台识别${店铺展示名}催票订单。`,
    });
    this.state.updateStoreResult(构建运行中店铺结果(店铺, 可见模式));
  }

  #推送分页读取状态(店铺, 店铺展示名, 可见模式, 进度) {
    // 解决：分页读取进度同步到任务摘要和巡检报告，用户不用盯黑窗日志。
    const 进度消息 = `正在读取${店铺展示名}发票分页：${进度.message}，每页=${进度.pageSize}，并发=${进度.concurrentPageCount}`;
    this.state.setTask({
      ...(this.state.currentTask || {}),
      status: 'running',
      label: '读取分页',
      message: 进度消息,
    });
    this.state.updateStoreResult(构建分页进度店铺结果(店铺, 可见模式, 进度));
  }

  async #执行带登录恢复的巡检(店铺, 选项) {
    // 解决：普通巡检失败后只对登录态失效错误打开人工登录恢复链。
    try {
      return await this.#调用巡检(店铺, 选项);
    } catch (错误) {
      if (!选项.可见模式 && 是需要自动拉起登录的错误(错误)) {
        return this.#执行人工登录恢复巡检(店铺, 选项);
      }
      this.#保存失败店铺结果(店铺, 错误);
      throw 错误;
    }
  }

  async #执行人工登录恢复巡检(店铺, 选项 = {}) {
    // 解决：后台识别发现未登录时只打开当前店铺登录窗口。
    const 等待登录消息 = `检测到「${店铺.name}」未登录，已自动打开登录窗口并提交账号密码；如京东要求滑块/验证码，请在窗口内人工完成。`;
    打印日志('后台任务', '控制台', 等待登录消息);
    this.state.setTask({
      ...(this.state.currentTask || {}),
      status: 'running',
      label: '等待登录',
      message: 等待登录消息,
    });
    this.state.updateStoreResult(构建等待登录店铺结果(店铺));

    try {
      return await this.#调用巡检(店铺, {
        可见模式: true,
        页面保留模式: 选项.页面保留模式,
        开始时间: 选项.开始时间,
        凭证批次目录: 选项.凭证批次目录,
        尝试次数: 选项.尝试次数,
        截图场景: '登录恢复',
        onProgress: 选项.onProgress,
      });
    } catch (恢复错误) {
      this.#保存失败店铺结果(店铺, 恢复错误);
      throw 恢复错误;
    }
  }

  async #调用巡检(店铺, 选项) {
    // 解决：巡检方法参数集中构造，批量关闭窗口规则不会散落到多处分支。
    const 巡检选项 = {
      店铺配置: 店铺,
      headless: !选项.可见模式,
      允许人工登录: 选项.可见模式,
      页面保留模式: 选项.页面保留模式,
      截图文件名: `${店铺.id}-latest.png`,
      onProgress: 选项.onProgress,
    };
    if (选项.凭证批次目录) {
      巡检选项.截图路径 = this.构建店铺凭证路径方法({
        批次目录: 选项.凭证批次目录,
        店铺,
        开始时间: 选项.开始时间,
        结果状态: '成功',
        尝试次数: 选项.尝试次数,
        场景: 选项.截图场景,
      });
      巡检选项.失败截图路径 = this.构建店铺凭证路径方法({
        批次目录: 选项.凭证批次目录,
        店铺,
        开始时间: 选项.开始时间,
        结果状态: '失败',
        尝试次数: 选项.尝试次数,
        场景: 选项.截图场景,
      });
      巡检选项.截图文件名 = path.basename(巡检选项.截图路径);
    }
    return this.执行巡检方法(巡检选项);
  }

  #保存失败店铺结果(店铺, 错误) {
    // 解决：失败结果保存和界面更新共用同一个出口。
    const 店铺结果 = 构建失败店铺结果(店铺, 错误);
    this.更新店铺结果方法(店铺结果);
    this.state.updateStoreResult(店铺结果);
    return 店铺结果;
  }

  #保存单店摘要({ 开始时间, 完成时间, 店铺, 店铺结果 }) {
    // 解决：单店结果单独记账，首页仍以最近批量总览为主。
    const 摘要 = 构建单店摘要({
      开始时间,
      完成时间,
      店铺列表: [店铺],
      店铺结果列表: [店铺结果],
      订单列表: this.记录转列表方法(this.读取订单记录方法()),
    });
    this.更新最近单店摘要方法(摘要);
    if (typeof this.state.setSingleSummary === 'function') {
      this.state.setSingleSummary(摘要);
    }
    return 摘要;
  }
}

module.exports = {
  ControlCenterTaskService,
};
