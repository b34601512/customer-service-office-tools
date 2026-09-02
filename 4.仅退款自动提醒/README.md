# 退款自动提醒

## 作者与版权

作者：黎路遥 ｜ 微信：luyao2089 ｜ 话术精灵官网：luyao2089.cc

版权所有 © 黎路遥，保留所有权利。本软件仅供学习交流，未经作者书面授权不得用于商业用途。

本工具用于在管易云 ERP 订单查询页自动扫描退款订单，并按配置的付款时间范围发系统通知。

## 启动

双击 `一键启动.vbs`，或运行：

```powershell
python run.py
```

无黑窗启动日志会写入 `logs/hidden-launch.log`，业务启动日志会写入 `logs/startup.log`。

## 使用顺序

1. 打开后台后先确认运行配置，自动查询间隔默认 5 分钟，最低不能小于 5 分钟；通知付款范围默认今天，也可改成 2/3/5/7 天内。
2. 点击「打开 ERP」，在受控浏览器里完成登录并进入订单查询页。
3. 点击「启动监控」开始定时查询订单表，导出当前页并采集退款订单。

判定规则很简单：导出订单表里有退款证据且平台单号合法，就进入后台列表；只有付款时间落在配置范围内的新增订单才发系统通知。

登录状态保存在 `runtime/browser_profiles` 下的独立浏览器目录，不会污染其他账号目录。

## 自检

```powershell
python run.py --check
python -m unittest discover -s tests
```

## 导出客服分发包

双击 `导出客服分发包.bat`，或运行：

```powershell
python -m release.build_portable_package
```

导出的 zip 会放在 `dist` 目录，分发包内置 Python 和依赖；目标电脑解压后直接双击 `启动后台.bat` 即可，不需要额外安装 Python。
