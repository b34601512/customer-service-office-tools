const fs=require("fs");
for (const p of ["D:/桌面/办公软件/9.客服数据自动更新/project-config/platform-config.json","D:/桌面/办公软件/12.店铺指标数据自动更新/project-config/platform-config.json"]) {
 const c=JSON.parse(fs.readFileSync(p,"utf8")); console.log("---",p); console.log(JSON.stringify(c.douyin||null,null,2)); }