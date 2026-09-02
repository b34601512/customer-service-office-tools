const path=require("path"); const root=process.cwd();
const {createControlCenterStateStore}=require(path.join(root,"src/controlCenter/controlCenterState"));
const {runConfiguredStoresTask}=require(path.join(root,"src/controlCenter/controlCenterTask"));
const {readStoreMetricConfig}=require(path.join(root,"src/config/storeMetricConfig"));
(async()=>{const stateStore=createControlCenterStateStore(); try{const result=await runConfiguredStoresTask(stateStore,{collectionScope:{type:"platform",platformKey:"douyin"}}); console.log("BATCH_RESULT",JSON.stringify({status:stateStore.read().status,successCount:result.successCount,collectedCount:result.collectedCount,skippedCount:result.skippedCount,errorCount:result.errorCount,stores:result.stores.map(s=>({key:s.storeKey,status:s.status,metricCount:s.metricCount,action:s.action,detail:s.detail}))},null,2));}catch(e){console.error("BATCH_ERROR",e.stack||e);process.exitCode=1;}})();
