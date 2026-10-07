const {request}=require('./request');
// 只在前台、卡片至少50%可见时上报；后端凭证绑定已认证工程师并去重。
function observe(page) {
 stop(page);
 if(!page._exposureActive || !page.data.exposures.length)return;
 page._exposureSeen=page._exposureSeen||new Set();
 page._exposureObserver=page.createIntersectionObserver({observeAll:true,thresholds:[0,0.5,1]});
 page._exposureObserver.relativeToViewport().observe('.exposure-card',async entry=>{
  if(!page._exposureActive || entry.intersectionRatio<0.5)return;
  const orderId=entry.dataset.id,token=entry.dataset.token;
  if(!orderId||!token||page._exposureSeen.has(orderId))return;
  page._exposureSeen.add(orderId);
  try{await request('POST','/home/exposures/impressions',{items:[{orderId,token}]},{silent:true});}
  catch(_){page._exposureSeen.delete(orderId);}
 });
}
function stop(page){if(page._exposureObserver){page._exposureObserver.disconnect();page._exposureObserver=null;}}
module.exports={observe,stop};
