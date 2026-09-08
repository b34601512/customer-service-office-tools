"""浏览器页面翻页与脱敏诊断；不直连接口，不刷新、不循环触发下一页。"""

# 详情标签页可能暂时遮住列表。等待两帧布局后，仅滚动实际承载岗位的容器一次。
# setTimeout 是布局等待的上限，不是网络重试；没有匹配响应仍须由业务层报超时。
SCROLL_ONCE_JS = r'''new Promise(resolve => {
    let finished = false;
    const run = () => {
        if (finished) return;
        finished = true;
        const root = document.scrollingElement || document.documentElement;
        const cards = Array.from(document.querySelectorAll('a[href*="/job_detail/"], .job-card-wrapper'));
        const candidates = new Set();
        for (const card of cards) {
            for (let el = card.parentElement; el && el !== document.body; el = el.parentElement) {
                const style = getComputedStyle(el);
                if (el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 1 &&
                    /^(auto|scroll)$/.test(style.overflowY)) candidates.add(el);
            }
        }
        let target = root, most = 0;
        for (const el of candidates) {
            const count = cards.filter(card => el.contains(card)).length;
            if (count > most) { target = el; most = count; }
        }
        if (!target) { resolve({container: 'none', moved: false}); return; }
        const before = target.scrollTop;
        target.scrollTo({top: target.scrollHeight, behavior: 'instant'});
        resolve({container: target === root ? 'document' : 'job-list', cards: cards.length,
                 before, after: target.scrollTop, height: target.scrollHeight,
                 viewport: target.clientHeight, moved: target.scrollTop !== before});
    };
    setTimeout(run, 250);
    requestAnimationFrame(() => requestAnimationFrame(run));
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
        print(f'[pagination] 单次滚动布局：{safe}', flush=True)
    else:
        print('[pagination] 已执行单次滚动；布局诊断不可用，仍以匹配接口响应为准', flush=True)
