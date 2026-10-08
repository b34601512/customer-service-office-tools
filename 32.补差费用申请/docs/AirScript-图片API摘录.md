# AirScript 图片相关 API 摘录（为 32号「收款码截图保留」查证用）

> 来源：官方 AirScript 文档（AirScript 2.0 完整版）离线镜像 https://github.com/GuoKe416/AirScript-Doc （README 写明由官方 https://www.kdocs.cn/airscript/docs 转换）。查证时间 2026-10-08。
> 用法提醒：InsertImage 属 **API文档(1.0)** 的 Range 方法；目标表现役脚本是 2.0 Beta——是否支持需实测（v5 加自检动作）。

## [InsertImage()​](#insertimage)

插入单元格图片

#### [参数​](#参数-6)

| 属性 | 数据类型 | 默认值 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| dataURL | string | undefined | 是 | base64 字符串形式的图片 |

#### [示例​](#示例-31)

js
```js
// 获取E1单元格
const range = Range('E1')
// 向目标单元格插入图片
range.InsertImage(
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAMAAABEpIrGAAACH1BMVEUAAAA9kP8mpv9Fv/8QT94TXeQAfv8trP0xr/0VUdoAcv8LgPs1sf4AgP4QUuURTuEVl/ksq/wAg/84tf4NUt80sf0bnPsPUuAAYfsAgP4UTtYAY/8GXPQRkv1Jxv8AZP86tv9Bvv9Gv/9Atv8KiPUOVesAZ+wbS8wUl/kjo/sAYv8PVekjovxBu/8AY/8trPxCu/8AW/AAcvAxsP0npvsYTdElo/oQT9o+uP8AYv8KVOIHdugAYfwAfPwbfe49uf4XmfkcdOopo/oAYv86tf4AYf8TT9cZaeYVTdUJVOUcnvsAYv8Agv9Iwv8AYv9Jwf8bSs0gofoAY/8Ag/9Gv/8en/oAYf9Fv/8AWuQZS80AdO5BvP8AYv9DvP8Umfo9uv8LVOUAgf8amfk/uf8AY/8Ag/8Ahf8TUdgVT9UNWOknov8trPwxr/wmpvspqfs1sv0io/s5tf0AgP8bnfoMV+4AYPoAYv8AYf4AYfwAe/sen/oAd/gAXvYAff0LW/MLWfEOUN0PT9oSTtZAu/49uP0qqfweoPoXmvkAdPUAXPIAcfEKUuIWTNIXS88KXPYAWusOVeoPVOkPUuYQUeQQT+IMUeAUTdMZSs09uP4Aa+kAWOgAaeQIVOQIU+QAV+MRTd8STd0RTtgSl/kAW+8NWO8Abu0AbuwBZNsAg/8AYPwAc/MIVecAZuEAVeAAWt8AZN0JgvAIfOsJV+sTVuIAU9qil9AQAAAAa3RSTlMAAwb++A3+bkkkGxL8+Pf36tnTubCYjol4dmVjRjEvLysZFA7+/Pv6+fj39/b19fPw8O/u7Ovq6Ofn5+Xj4uDa2trZ1dPS0s/Ny7+9vLi4trapoqGgoJ2XkI+KgoJycGRhX1BNS0pHQj06IcCB3jkAAAIBSURBVDjLdZCHctpAFEWfCMU1ce8tTu+99957770nJFGwkE1sgyMTAginYbkAIQSD494+0G+ltTAacWZnNLt7dO/Og3Tqzl2og8wsvroAudEI+iy5s+6LzMZ7Bp1r5sFOQegRenAJwoEnoCXr6Mc0ihvSrhuK32vJK21Mva00760OWyz0KZYNbzJQmKXUF1o7rZ24rGngweETIGOwbH2nw/ZDUaM6grJVHzSs3R+NoqDy+lKLuwWX2618r03/QRalhNzbewo+qZyuZX4TVMFQubm3f3xy5VeZg49xsL8IC+mUH+1zeLyJ3pHkRCwWK7hvIGc/CYrwvIhtbXZ4hgYwJLm0LFf56QdhDRAq8wdZMypD3kT/SBJo6nfCMmWTc2WQlUO8GDIn2GSAUnuWGERJpIS4LR4HlWdFNITua9pl5s3h5vJ81tzscAAhuyTc3kZQ51CxqasvMmDGENyZyo1BX2iqLRAI0L7qvU2fv6Ex5mVbgana4XIGfb7QsI0KNcc4O4/Gv67I6Jjn5cmOvy4nGuFwaFipqFjN2YlBQkZn/N0dxAhiSfjUKzqHyxwq/0lIX0T0d6OAGb7dD0Gl/gzH8UqN6JcNp7HcBPN5esTO8U2oSCIpcZVkgwamepedxxpJROP4C9DBdHc9vlWSxG1VDOiTc53jpRW3TJCZ+vMXNeWzDz4DoNZyqecAAAAASUVORK5CYII='
)
```

### [Shapes.GetActiveShapeImg()​](#shapes-getactiveshapeimg)

获取激活单元格的图片数据

#### [返回类型​](#返回类型-1)

String - 图片原图下载链接

#### [示例​](#示例-14)

js
```js
// 假如A1有图片
Application.Range('A1').Select()
const imgUrl = Application.ActiveSheet.Shapes.GetActiveShapeImg()
console.log(imgUrl) // https://imageUrl 如果没有图片则返回undefined
```

### [Shapes.Item(Index)​](#shapes-item-index)


## 官方「使用限制 / 接口选择」摘录（2026-10-08 查，同一镜像）

- **限流（原文）**：「过于高频地使用高级服务，当出现这种情况时，脚本的运行会抛出明显的错误通知用户异常调用。」
  （无具体 QPS 数字；对应我们实测的 HTTP 403 `ScriptRetryLater` / HTTP 500 `Unavailable`。）
- **正文大小（原文）**：「使用 HTTP 服务时，收到内容的消息体最大为 2M，超过 2M 会抛出错误。」
- **同步 vs 异步接口（原文）**：「我们提供了同步执行和异步执行两种脚本执行接口……前者（同步）接口调用后会直接返回执行结果，适用于执行耗时一般的场景；
  后者（异步）接口调用后不会返回最终的执行结果，但会立即返回一个 task_id，您需要根据此 task_id 轮询脚本执行的日志……适用于执行耗时比较大的场景。」
  - 同步：`POST /api/v3/ide/file/:file_id/script/:script_id/sync_task`
  - 异步：`POST /api/v3/ide/file/:file_id/script/:script_id/task`
- **结论（我们自己的口径，非官方规定）**：`InsertImage` 只有「一格一图」形态（无批量接口）；我们采用"逐张串行 + 遇错停手"是出于
  ①正文小（单张最大 277KB）②不自动重试 的保守打法。更贴官方的做法：一次带 2~3 张（远低于 2M）、大批量/耗时长的走异步接口。
