// 开机自启的 ASCII 入口（给同目录「静默启动.vbs」调用）。
// 为什么单独一个文件：.vbs 必须保持纯 ASCII——中文文件名/中文路径当参数传进 WSH
// 会踩编码坑（实测：中文变量名 + UTF-8 存盘的 vbs 直接编译失败，自启无声无息起不来）。
// 用 ASCII 文件名做入口，中文都留在 .mjs（UTF-8）里，WSH 永远不碰。
import { main } from "./守护骨架.mjs";

await main();
