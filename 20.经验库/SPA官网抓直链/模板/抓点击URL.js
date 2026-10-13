// 抓「点击后才知道的 URL」：粘到浏览器控制台（或自动化工具的页面执行里）运行；之后触发点击，读 window.__抓。
// 覆盖三种逃逸口：window.open、<a>.click()、以及捕获阶段的真实点击。
(() => {
  window.__抓 = window.__抓 || [];
  const 记 = (u) => {
    try {
      window.__抓.push(String(u));
    } catch (e) { /* 忽略 */ }
  };

  const 原open = window.open;
  window.open = (...a) => {
    记(a[0]);
    return 原open.apply(window, a);
  };

  const 原aClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    记(this.href);
    return 原aClick.call(this);
  };

  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a) 记(a.href);
  }, true);

  console.log("钩子已装。触发点击后，在控制台里看 window.__抓（数组）。");
})();
