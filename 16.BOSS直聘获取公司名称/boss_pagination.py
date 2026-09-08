"""浏览器页面翻页与脱敏诊断；不直连接口，不刷新、不循环触发下一页。"""

# 旧实现自动挑选带 overflow 的岗位祖先容器，但实机 r4 连续出现“容器已滚到底、却完全
# 没有第2页请求”。r3 使用文档滚动时同命令曾成功，因此这里回到页面自身滚动上下文。
# 只做一次有界的“接近底部 -> 底部”动作，让页面原生 scroll / IntersectionObserver 有机会
# 触发；不循环滚动、不直接调用网站接口、不伪造翻页请求。
SCROLL_ONCE_JS = r'''new Promise(resolve => {
    const root = document.scrollingElement || document.documentElement;
    const cards = document.querySelectorAll('a[href*="/job_detail/"], .job-card-wrapper').length;
    const before = root.scrollTop;
    const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
    const nearBottom = Math.max(0, maxTop - Math.min(240, Math.max(80, root.clientHeight / 4)));
    window.scrollTo(0, nearBottom);
    requestAnimationFrame(() => {
        window.scrollTo(0, maxTop);
        setTimeout(() => resolve({
            container: 'document', cards,
            before, after: root.scrollTop,
            height: root.scrollHeight, viewport: root.clientHeight,
            moved: root.scrollTop !== before
        }), 350);
    });
})'''


def has_matching_request(session):
    expected = getattr(session, 'expected_joblist', None)
    requests = getattr(session, 'joblist_requests', None)
    if not isinstance(expected, dict) or not expected or not isinstance(requests, dict):
        return False
    return any(isinstance(fields, dict) and all(
        fields.get(key, [None])[0] == str(value) for key, value in expected.items()
    ) for fields in requests.values())


def request_diagnostics(session):
    """仅输出页码/数量，不输出URL、Cookie、请求正文或会话标识。"""
    requests = getattr(session, 'joblist_requests', {})
    pages = set()
    if isinstance(requests, dict):
        for fields in requests.values():
            if isinstance(fields, dict):
                values = fields.get('page', [])
                if isinstance(values, list) and values and str(values[0]).isascii() and str(values[0]).isdigit():
                    pages.add(int(values[0]))
    observed = ','.join(map(str, sorted(pages)[:20])) or 'none'
    return f'matching_request={has_matching_request(session)}; observed_pages={observed}'


def advance_page(session):
    session.command('Page.bringToFront')
    # 等待命令响应的同时 CDP 会收取列表标签页的已缓存网络事件。
    # 站点已经预取目标页时只消费它，避免又滚动一次造成跳页或额外请求。
    if has_matching_request(session):
        print('[pagination] 目标页已有请求/预取响应，仅等待完整响应', flush=True)
        return
    response = session.command('Runtime.evaluate', {
        'expression': SCROLL_ONCE_JS, 'returnByValue': True, 'awaitPromise': True,
    }, timeout=5)
    metrics = response.get('result', {}).get('value') if isinstance(response, dict) else None
    if isinstance(metrics, dict):
        safe = {key: metrics[key] for key in ('cards', 'before', 'after', 'height', 'viewport', 'moved')
                if key in metrics and isinstance(metrics[key], (int, float, bool))}
        print(f'[pagination] 单次文档滚动：{safe}', flush=True)
    else:
        print('[pagination] 已执行单次文档滚动；布局诊断不可用，仍以匹配接口响应为准', flush=True)
