'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../miniapp');
function tracker(request){const module={exports:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'utils/exposure-tracker.js'),'utf8'),{module,require:()=>({request})});return module.exports;}
function observed(request){const track=tracker(request);let callback,disconnected=false;const p={data:{exposures:[{id:'o'}]},_exposureActive:true,createIntersectionObserver(){return {relativeToViewport(){return this;},observe(selector,fn){assert.equal(selector,'.exposure-card');callback=fn;},disconnect(){disconnected=true;}};}};track.observe(p);return {p,track,see:ratio=>callback({intersectionRatio:ratio,dataset:{id:'o',token:'token'}}),disconnected:()=>disconnected};}
function component(request,{confirms=[true,true],paymentFail=false}={}){
 let c;const calls=[],toasts=[];
 const wx={showModal:o=>{calls.push(o.title);o.success({confirm:confirms.shift()});},requestPayment:o=>{calls.push('wx.requestPayment');if(paymentFail)o.fail({errMsg:'requestPayment:fail cancel'});else o.success();},showToast:o=>toasts.push(o.title),navigateTo:o=>calls.push(o.url)};
 vm.runInNewContext(fs.readFileSync(path.join(root,'components/exposure-status/index.js'),'utf8'),{Component:x=>c=x,require:()=>({request}),wx,setInterval:()=>1,clearInterval(){}});
 const p={...c.methods,data:{...c.data,orderId:'o',orderStatus:'QUOTING',ready:true},_active:true,setData(x){Object.assign(this.data,x);}};
 return {p,calls,toasts};
}
test('曝光卡片达到50%可见才上报，同页重复可见不重复，后台停止计数',async()=>{
 const calls=[],o=observed(async(...args)=>calls.push(args));
 await o.see(0.49);assert.equal(calls.length,0);await o.see(0.5);await o.see(1);assert.equal(calls.length,1);
 assert.equal(calls[0][1],'/home/exposures/impressions');assert.equal(calls[0][2].items[0].token,'token');
 o.p._exposureActive=false;o.p._exposureSeen.clear();await o.see(1);assert.equal(calls.length,1);
 o.track.stop(o.p);assert.equal(o.disconnected(),true);
});
test('上报失败释放本地去重标记，下次可见可以重试',async()=>{
 let n=0;const o=observed(async()=>{if(++n===1)throw Error('offline');});
 await o.see(1);await o.see(1);await o.see(1);assert.equal(n,2);
});
test('曝光支付取消确认不创建支付，取消微信支付不调用模拟确认',async()=>{
 let n=0;const canceled=component(async()=>{n++;},{confirms:[false]});await canceled.p.pay();assert.equal(n,0);assert.equal(canceled.p.data.busy,false);
 const calls=[],real=component(async(m,url)=>{calls.push(url);return {mode:'wechat',amountFen:1900};},{paymentFail:true});
 await real.p.pay();assert.equal(real.calls.includes('wx.requestPayment'),true);assert(calls.some(s=>s.endsWith('/cancel')));assert(calls.some(s=>s.endsWith('/exposure')));assert.ok(!calls.some(s=>s.endsWith('/mock-confirm')));
});
test('模拟支付需要明确确认，服务端支付成功才显示开通',async()=>{
 const calls=[];let paid=false;const c=component(async(m,url)=>{calls.push([m,url]);if(url.endsWith('/pay'))return {mode:'mock',amountFen:1900};if(url.endsWith('/mock-confirm')){paid=true;return{};}return {state:paid?'ACTIVE':'UNPAID',targetPeople:100,deliveredPeople:0,progress:0,amountFen:1900,paymentMode:'mock'};});
 await c.p.pay();assert.equal(c.calls.includes('模拟曝光支付'),true);assert.equal(paid,true);assert.equal(c.p.data.info.state,'ACTIVE');assert.equal(c.toasts[0],'曝光已开通');
 const declined=component(async()=>({mode:'mock',amountFen:1900}),{confirms:[true,false]});await declined.p.pay();assert.equal(declined.toasts.length,0);
});
test('真实支付后查进度失败不会误报开通，待确认保留进度查询入口',async()=>{
 const c=component(async(m,url)=>{if(m==='POST')return {mode:'wechat',amountFen:1900};throw Error('offline');});
 await c.p.pay();assert.match(c.toasts[0],/待确认/);assert.equal(c.p.data.info,null);assert.equal(c.p.data.error,'offline');
});
test('详情状态保留精确人数和进度，客户首页提示链接进入订单详情',async()=>{
 const c=component(async()=>({state:'ACTIVE',targetPeople:300,deliveredPeople:71,progress:23,amountFen:5700}));
 await c.p.load();assert.equal(c.p.data.info.deliveredPeople,71);assert.equal(c.p.data.units,3);
 const markup=fs.readFileSync(path.join(root,'components/exposure-status/index.wxml'),'utf8');assert.match(markup,/percent="\{\{info.progress\}\}"/);assert.match(markup,/info.deliveredPeople/);
 let home,navigation;vm.runInNewContext(fs.readFileSync(path.join(root,'pages/home/index.js'),'utf8'),{Page:p=>home=p,require:()=>({}),wx:{navigateTo:o=>navigation=o.url}});
 home.openMine({currentTarget:{dataset:{id:'o'}}});assert.equal(navigation,'/pages/order-detail/index?id=o&mode=customer');
 assert.match(fs.readFileSync(path.join(root,'pages/order-detail/index.wxml'),'utf8'),/<exposure-status[^>]*order-id="\{\{id\}\}"/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')).usingComponents['exposure-status'],'/components/exposure-status/index');
});
