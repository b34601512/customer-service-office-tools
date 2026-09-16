// 一次性搬迁：分发包(dist/发布包/release_package/发布) + 两处凭证/结果图 → D:\备份文件夹
// 搬完逐项给「应有 vs 实有」：源目录应消失、备份目录文件数应一致
const fs = require('fs');
const path = require('path');

const 工作区 = 'D:/桌面/办公软件';
const 备份根 = 'D:/备份文件夹/办公软件产物备份_20260916';

const 项目 = [
  // ① 分发包 / 构建产物
  '11.视频压缩工具/dist',
  '11.视频压缩工具/build',
  '11.视频压缩工具/release',
  '2.发票自动化/2.京东发票回传/dist',
  '2.发票自动化/dist',
  '3.响应时间/dist',
  '3.响应时间/发布包',
  '8.抖音直播评论家/dist',
  '8.抖音直播评论家/release_package',
  '9.客服数据自动更新/发布包',
  '16.BOSS直聘获取公司名称/发布',
  '10.自动报量/html导入工具/自动报量-v0.5.zip',
  '10.自动报量/html导入工具/自动报量-v0.6.zip',
  // ② 两处「故意没动」的产物：凭证文件夹 + 报量结果图
  '9.客服数据自动更新/runtime/evidence',
  '12.店铺指标数据自动更新/runtime/evidence',
  '10.自动报量/自动报量输出/截图',
];

function 统计(目标) {
  if (!fs.existsSync(目标)) return { 文件: 0, 字节: 0 };
  const 信息 = fs.statSync(目标);
  if (信息.isFile()) return { 文件: 1, 字节: 信息.size };
  let 文件 = 0, 字节 = 0;
  const 走 = (目录) => {
    for (const 项 of fs.readdirSync(目录, { withFileTypes: true })) {
      const 路径 = path.join(目录, 项.name);
      if (项.isDirectory()) 走(路径);
      else { 文件 += 1; 字节 += fs.statSync(路径).size; }
    }
  };
  走(目标);
  return { 文件, 字节 };
}

const MB = (n) => (n / 1024 / 1024).toFixed(1) + 'MB';
let 合计文件 = 0, 合计字节 = 0;
const 行 = [];

for (const 相对 of 项目) {
  const 源 = path.join(工作区, 相对);
  const 目标 = path.join(备份根, 相对);
  if (!fs.existsSync(源)) {
    行.push([相对, '源不存在（跳过）', '', '']);
    continue;
  }
  const 前 = 统计(源);
  fs.mkdirSync(path.dirname(目标), { recursive: true });
  if (fs.existsSync(目标)) {
    行.push([相对, '备份里已存在同名，未覆盖 ✗', 前.文件, '']);
    continue;
  }
  try {
    fs.renameSync(源, 目标);
  } catch (_e) {
    fs.cpSync(源, 目标, { recursive: true });
    fs.rmSync(源, { recursive: true, force: true });
  }
  const 后 = 统计(目标);
  const 源还在 = fs.existsSync(源);
  const 对账 = (!源还在 && 后.文件 === 前.文件) ? '✓' : '✗';
  合计文件 += 后.文件; 合计字节 += 后.字节;
  行.push([相对, 对账, 前.文件, 后.文件 + ' / ' + MB(后.字节)]);
}

console.log('  搬迁结果（源文件数 → 备份文件数）');
console.log('  ' + '项目'.padEnd(46) + '对账  源    备份');
for (const [名, 标记, 源数, 备数] of 行) {
  console.log('  ' + 名.padEnd(46) + String(标记).padEnd(6) + String(源数).padEnd(6) + 备数);
}
console.log('');
console.log(`  合计：${合计文件} 个文件 / ${MB(合计字节)} → ${备份根}`);
