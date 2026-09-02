const { 打印日志 } = require('../common/logger');

async function 短暂停顿(page, 毫秒) {
  // 解决：连续关闭多层京东提示时给前端框架一点卸载 DOM 的时间。
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(毫秒);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 毫秒));
}

async function 清理京东遮挡弹窗(page, 选项 = {}) {
  // 解决：京东公告、引导、菜单更新等遮挡弹窗会拦截鼠标，点击业务标签前先保守关闭。
  const { maxPasses = 3 } = 选项;
  const 已关闭动作 = [];

  for (let 当前轮次 = 0; 当前轮次 < maxPasses; 当前轮次 += 1) {
    const 清理结果 = await page.evaluate(() => {
      const 清洗 = (文本) => String(文本 ?? '').replace(/\s+/g, ' ').trim();
      const 读取类名 = (元素) => {
        if (!元素?.className) return '';
        return typeof 元素.className === 'string' ? 元素.className : String(元素.className.baseVal || '');
      };
      const 可见 = (元素) => {
        if (!元素) return false;
        const 样式 = window.getComputedStyle(元素);
        const 矩形 = 元素.getBoundingClientRect();
        return 样式.display !== 'none'
          && 样式.visibility !== 'hidden'
          && Number(样式.opacity || '1') > 0.01
          && 矩形.width > 0
          && 矩形.height > 0;
      };
      const 是遮挡容器 = (元素) => {
        const 样式 = window.getComputedStyle(元素);
        const 类名 = 读取类名(元素);
        const 角色 = 元素.getAttribute('role') || '';
        const 矩形 = 元素.getBoundingClientRect();
        const zIndex = Number.parseInt(样式.zIndex || '0', 10);
        const 是固定高层 = ['fixed', 'sticky'].includes(样式.position) && (Number.isFinite(zIndex) ? zIndex >= 10 : true);
        const 是弹层类名 = /dialog|modal|drawer|popup|popover|toast|notice|guide|tour|mask|overlay/i.test(类名);
        const 是语义弹窗 = 角色 === 'dialog' || 元素.getAttribute('aria-modal') === 'true';
        const 面积占比 = (矩形.width * 矩形.height) / Math.max(1, window.innerWidth * window.innerHeight);
        return 是弹层类名 || 是语义弹窗 || (是固定高层 && 面积占比 >= 0.03);
      };
      const 查找遮挡根 = (元素) => {
        for (let 当前元素 = 元素; 当前元素 && 当前元素 !== document.body; 当前元素 = 当前元素.parentElement) {
          if (可见(当前元素) && 是遮挡容器(当前元素)) return 当前元素;
        }
        return null;
      };
      const 是安全关闭动作 = (动作文本, 弹窗文本) => {
        const 文本 = 清洗(动作文本).replace(/\s+/g, '');
        const 根文本 = 清洗(弹窗文本).replace(/\s+/g, '');
        const 明确关闭 = /^(知道了|我知道了|知道啦|明白|明白了|关闭|关闭弹窗|下次再说|稍后再说|暂不|忽略|跳过|不再提示|取消)$/.test(文本);
        const 需要通知语境 = /^(确定|确认)$/.test(文本);
        const 通知语境 = /通知|公告|更新|升级|调整|新菜单|新功能|引导|提示|指南|规则|说明|教程|问卷|满意度|评价|反馈|调研|菜单/.test(根文本);
        const 危险语境 = /删除|提交|上传|回传|推送|开票|驳回|退款|支付|转账|授权|解绑|退出登录|清空|作废|取消订单/.test(根文本);
        if (明确关闭 && !危险语境) return true;
        return 需要通知语境 && 通知语境 && !危险语境;
      };
      const 读取动作文本 = (元素) => 清洗([
        元素.innerText || 元素.textContent || '',
        元素.getAttribute('aria-label') || '',
        元素.getAttribute('title') || '',
      ].join(' '));
      const 点击元素 = (元素) => {
        元素.scrollIntoView({ block: 'center', inline: 'center' });
        元素.click();
      };

      document.querySelectorAll([
        'shop-common-components[type="NPS"]',
        '.AiHelperOpenExtension',
        '[class*="AiHelper"]',
        '[id*="AiHelper"]',
        '[class*="Aihelper"]',
        '[id*="Aihelper"]',
      ].join(',')).forEach((元素) => {
        元素.style.pointerEvents = 'none';
      });

      const 控件列表 = Array.from(document.querySelectorAll([
        'button',
        'a',
        '[role="button"]',
        '[aria-label]',
        '[title]',
        '.jd-dialog__close',
        '.ant-modal-close',
        '.next-dialog-close',
        '.el-dialog__close',
      ].join(','))).filter(可见);

      const 候选列表 = [];
      for (const 控件 of 控件列表) {
        const 遮挡根 = 查找遮挡根(控件);
        if (!遮挡根) continue;
        const 动作文本 = 读取动作文本(控件);
        const 弹窗文本 = 清洗(遮挡根.innerText || 遮挡根.textContent);
        const 类名 = 读取类名(控件);
        const 是关闭图标 = /close/i.test(类名)
          || /关闭|close/i.test(控件.getAttribute('aria-label') || '')
          || /关闭|close/i.test(控件.getAttribute('title') || '');
        const 可以点击 = 是关闭图标 || 是安全关闭动作(动作文本, 弹窗文本);
        if (!可以点击) continue;
        候选列表.push({
          控件,
          动作文本: 动作文本 || (是关闭图标 ? '关闭图标' : ''),
          弹窗文本,
          分数: /知道|明白/.test(动作文本) ? 0 : 是关闭图标 ? 1 : 2,
        });
      }

      const 命中 = 候选列表.sort((a, b) => a.分数 - b.分数)[0];
      if (!命中) {
        return { closed: false };
      }
      点击元素(命中.控件);
      return {
        closed: true,
        actionText: 命中.动作文本 || '关闭图标',
        popupText: 命中.弹窗文本.slice(0, 60),
      };
    }).catch(() => ({ closed: false }));

    if (!清理结果?.closed) break;
    已关闭动作.push(清理结果.actionText || '关闭');
    await 短暂停顿(page, 150);
  }

  if (已关闭动作.length > 0) {
    打印日志('页面导航', '遮挡弹窗', `已自动关闭 ${已关闭动作.length} 个京东遮挡弹窗：${已关闭动作.join('、')}`);
  }
  return {
    closedCount: 已关闭动作.length,
    actions: 已关闭动作,
  };
}

async function 禁用常见遮挡浮层(page) {
  // 解决：京东悬浮组件可能挡住顶部标签，点击前先取消这些浮层的鼠标拦截。
  return 清理京东遮挡弹窗(page);
}

async function 获取顶部全部标签点击点(page) {
  // 解决：只点击和“近3个月待开票”同一组的顶部“全部”，避免误点筛选区的全部。
  return page.evaluate(() => {
    const 清洗 = (文本) => String(文本 ?? '').replace(/\s+/g, ' ').trim();
    const 可见 = (元素) => {
      if (!元素) return false;
      const 样式 = window.getComputedStyle(元素);
      const 矩形 = 元素.getBoundingClientRect();
      return 样式.display !== 'none' && 样式.visibility !== 'hidden' && 矩形.width > 0 && 矩形.height > 0;
    };
    const 读取类名 = (元素) => {
      if (!元素?.className) return '';
      return typeof 元素.className === 'string' ? 元素.className : String(元素.className.baseVal || '');
    };
    const 构建点击目标 = (文本元素) => {
      for (let 当前元素 = 文本元素; 当前元素 && 当前元素 !== document.body; 当前元素 = 当前元素.parentElement) {
        if (!可见(当前元素)) continue;
        const 角色 = 当前元素.getAttribute('role') || '';
        const 类名 = 读取类名(当前元素);
        const 文本 = 清洗(当前元素.innerText || 当前元素.textContent);
        if (文本 !== '全部') break;
        if (
          当前元素.tagName === 'A'
          || 当前元素.tagName === 'BUTTON'
          || 角色 === 'tab'
          || 角色 === 'button'
          || /tab|tabs|menu.*item|nav/i.test(类名)
        ) {
          return 当前元素;
        }
      }
      return 文本元素;
    };
    const 构建点击点 = (元素) => {
      元素.scrollIntoView({ block: 'center', inline: 'center' });
      const 矩形 = 元素.getBoundingClientRect();
      if (矩形.width <= 0 || 矩形.height <= 0) return null;
      return {
        ok: true,
        x: 矩形.left + 矩形.width / 2,
        y: 矩形.top + 矩形.height / 2,
        text: 清洗(元素.innerText || 元素.textContent),
      };
    };

    const 元素列表 = Array.from(document.querySelectorAll('body *')).filter(可见);
    const 待开票标签列表 = 元素列表
      .filter((元素) => /^近\s*3\s*个月\s*待开票(?:\s*\(\d+\))?$/.test(清洗(元素.innerText || 元素.textContent)));
    const 全部标签列表 = 元素列表
      .filter((元素) => 清洗(元素.innerText || 元素.textContent) === '全部');
    const 候选列表 = [];

    for (const 全部标签 of 全部标签列表) {
      const 全部矩形 = 全部标签.getBoundingClientRect();
      const 全部中心Y = (全部矩形.top + 全部矩形.bottom) / 2;
      for (const 待开票标签 of 待开票标签列表) {
        const 待开票矩形 = 待开票标签.getBoundingClientRect();
        const 待开票中心Y = (待开票矩形.top + 待开票矩形.bottom) / 2;
        const 横向距离 = 待开票矩形.left - 全部矩形.right;
        if (Math.abs(全部中心Y - 待开票中心Y) <= 24 && 横向距离 >= 0 && 横向距离 <= 180) {
          候选列表.push({
            元素: 全部标签,
            分数: 横向距离 + Math.abs(全部中心Y - 待开票中心Y) * 10,
          });
        }
      }
    }

    const 命中标签 = 候选列表.sort((a, b) => a.分数 - b.分数)[0]?.元素;
    if (!命中标签) {
      return { ok: false, message: '未找到顶部“全部”标签。' };
    }
    return 构建点击点(构建点击目标(命中标签)) || { ok: false, message: '顶部“全部”标签不可点击。' };
  });
}

async function 获取顶部待开票标签点击点(page) {
  // 解决：页面已经停在“全部”时，再点“全部”可能不发请求，需要先切到待开票标签。
  return page.evaluate(() => {
    const 清洗 = (文本) => String(文本 ?? '').replace(/\s+/g, ' ').trim();
    const 可见 = (元素) => {
      if (!元素) return false;
      const 样式 = window.getComputedStyle(元素);
      const 矩形 = 元素.getBoundingClientRect();
      return 样式.display !== 'none' && 样式.visibility !== 'hidden' && 矩形.width > 0 && 矩形.height > 0;
    };
    const 构建点击点 = (元素) => {
      元素.scrollIntoView({ block: 'center', inline: 'center' });
      const 矩形 = 元素.getBoundingClientRect();
      if (矩形.width <= 0 || 矩形.height <= 0) return null;
      return {
        ok: true,
        x: 矩形.left + 矩形.width / 2,
        y: 矩形.top + 矩形.height / 2,
        text: 清洗(元素.innerText || 元素.textContent),
      };
    };
    const 命中标签 = Array.from(document.querySelectorAll('body *'))
      .filter((元素) => 可见(元素) && /^近\s*3\s*个月\s*待开票(?:\s*\(\d+\))?$/.test(清洗(元素.innerText || 元素.textContent)))
      .sort((a, b) => 清洗(a.innerText || a.textContent).length - 清洗(b.innerText || b.textContent).length)[0];
    if (!命中标签) {
      return { ok: false, message: '未找到顶部“近3个月待开票”标签。' };
    }
    return 构建点击点(命中标签) || { ok: false, message: '顶部“近3个月待开票”标签不可点击。' };
  });
}

async function 读取顶部发票标签状态(page) {
  // 解决：点击标签后必须按京东真实选中态确认页面已经切换；京东新版会只用蓝色文字和下划线表示选中。
  return page.evaluate(() => {
    const 清洗 = (文本) => String(文本 ?? '').replace(/\s+/g, ' ').trim();
    const 可见 = (元素) => {
      if (!元素) return false;
      const 样式 = window.getComputedStyle(元素);
      const 矩形 = 元素.getBoundingClientRect();
      return 样式.display !== 'none' && 样式.visibility !== 'hidden' && 矩形.width > 0 && 矩形.height > 0;
    };
    const 读取类名 = (元素) => {
      if (!元素?.className) return '';
      return typeof 元素.className === 'string' ? 元素.className : String(元素.className.baseVal || '');
    };
    const 判断激活 = (元素) => {
      const 类名 = 读取类名(元素);
      return 元素.getAttribute('aria-selected') === 'true' || /\bis-active\b|\bactive\b|\bselected\b|\bcurrent\b/i.test(类名);
    };

    const 是京东强调蓝 = (颜色) => {
      const 数值列表 = String(颜色 || '').match(/[\d.]+/g)?.map(Number) || [];
      const [红 = 0, 绿 = 0, 蓝 = 0, 透明度 = 1] = 数值列表;
      return 透明度 > 0.1 && 蓝 >= 120 && 蓝 > 红 * 1.2 && 蓝 > 绿 * 1.1;
    };

    const 有蓝色下划线 = (元素) => {
      for (const 伪元素 of ['::before', '::after']) {
        const 样式 = window.getComputedStyle(元素, 伪元素);
        const 内容 = 样式.content || '';
        const 高度 = Number.parseFloat(样式.height || '0');
        const 宽度 = Number.parseFloat(样式.width || '0');
        const 有内容 = 内容 !== 'none' && 内容 !== 'normal';
        const 有尺寸 = 高度 >= 1 && 宽度 >= 1;
        const 是可见 = 样式.display !== 'none' && 样式.visibility !== 'hidden';
        if (有内容 && 有尺寸 && 是可见 && (是京东强调蓝(样式.backgroundColor) || 是京东强调蓝(样式.borderBottomColor))) {
          return true;
        }
      }
      return false;
    };

    const 读取标签视觉选中态 = (元素) => {
      const 标签文本 = 清洗(元素.innerText || 元素.textContent);
      for (let 当前元素 = 元素; 当前元素 && 当前元素 !== document.body; 当前元素 = 当前元素.parentElement) {
        if (清洗(当前元素.innerText || 当前元素.textContent) !== 标签文本) break;
        const 样式 = window.getComputedStyle(当前元素);
        if (是京东强调蓝(样式.color) || 是京东强调蓝(样式.borderBottomColor) || 有蓝色下划线(当前元素)) {
          return true;
        }
      }
      return false;
    };

    const 读取标签 = (匹配标签) => {
      const 标签列表 = Array.from(document.querySelectorAll('[role="tab"], .jd-tabs__item, body *'))
        .filter(可见)
        .map((元素) => ({
          text: 清洗(元素.innerText || 元素.textContent),
          className: 读取类名(元素),
          ariaSelected: 元素.getAttribute('aria-selected') || '',
          semanticActive: 判断激活(元素),
          visualActive: 读取标签视觉选中态(元素),
        }))
        .filter(匹配标签);
      return {
        text: 标签列表[0]?.text || '',
        semanticActive: 标签列表.some((标签) => 标签.semanticActive),
        visualActive: 标签列表.some((标签) => 标签.visualActive),
        tabs: 标签列表,
      };
    };

    const 全部标签 = 读取标签((标签) => 标签.text === '全部');
    const 待开票标签 = 读取标签((标签) => /^近\s*3\s*个月\s*待开票(?:\s*\(\d+\))?$/.test(标签.text));
    const 全部已激活 = 全部标签.semanticActive || (全部标签.visualActive && !待开票标签.semanticActive && !待开票标签.visualActive);
    const 待开票已激活 = 待开票标签.semanticActive || (待开票标签.visualActive && !全部标签.semanticActive && !全部标签.visualActive);
    return {
      allActive: 全部已激活,
      pendingActive: 待开票已激活,
      allText: 全部标签.text,
      pendingText: 待开票标签.text,
      tabs: [...全部标签.tabs, ...待开票标签.tabs],
    };
  });
}

module.exports = {
  清理京东遮挡弹窗,
  禁用常见遮挡浮层,
  获取顶部全部标签点击点,
  获取顶部待开票标签点击点,
  读取顶部发票标签状态,
};
