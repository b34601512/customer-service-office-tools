const path=require("path");
const root=process.cwd();
const appConfig=require(path.join(root,"src/config/appConfig"));
const config=require(path.join(root,"src/config/storeMetricConfig")).readStoreMetricConfig();
for (const s of config.douyin.stores) console.log(JSON.stringify({key:s.key,displayName:s.displayName,id:s.platformStoreId,name:s.platformStoreName,profile:appConfig.getStoreAccountChromeUserDataDir("douyin","shared-login-account",s.username),site:s.sources.experienceScore},null,2));
