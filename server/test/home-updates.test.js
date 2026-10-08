'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../../miniapp');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {homeUpdates}=require('../../miniapp/utils/home-updates');
const notices=[{id:'o',text:'需求正在曝光，点击查看推流进度',projectName:'流体仿真'}];
const announcements=[{id:'a',revision:1,title:'服务公告',content:'详细公告内容'}];
const campaigns=[{id:'invite',title:'邀请好友得仿真币',subtitle:'查看我的邀请海报'}];
function page(request=async()=>[]){
 let definition;const navigation=[],modals=[],dismissals=[];
 vm.runInNewContext(read('pages/home/index.js'),{
  Page:p=>definition=p,
  require:name=>name.endsWith('/home-updates')?{homeUpdates}:name.endsWith('/exposure-tracker')?{stop(){}}:{request},
  wx:{navigateTo:o=>navigation.push(o.url),showModal:o=>modals.push(o),showToast(){}},clearInterval(){},
 });
 definition.data=JSON.parse(JSON.stringify(definition.data));
 definition.data.role='CUSTOMER';definition.data.user={id:'u'};
 definition.setData=(patch,done)=>{Object.assign(definition.data,patch);if(done)done();};
 definition.selectComponent=id=>{assert.equal(id,'#home-announcements');return {dismiss:(...args)=>dismissals.push(args)};};
 return {p:definition,navigation,modals,dismissals};
}
test('客户首页只折叠订单进度和公告，活动与预算保留原有独立模块和入口',()=>{
 const {p,navigation,modals,dismissals}=page();
 p.setData({notices,announcements,campaigns});p.refreshUpdates();
 assert.equal(p.data.updatesExpanded,false);
 assert.deepEqual(p.data.homeUpdates.map(item=>item.kind),['order','announcement']);
 for(const item of p.data.homeUpdates)p.openUpdate({currentTarget:{dataset:{key:item.key}}});
 p.openCampaign({currentTarget:{dataset:{id:'invite'}}});p.goEstimate();
 assert.deepEqual(navigation,['/pages/order-detail/index?id=o&mode=customer','/pages/activity/index?id=invite','/pages/estimate/index']);
 assert.equal(modals[0].content,'详细公告内容');
 p.dismissUpdate({currentTarget:{dataset:{key:'announcement:a:1'}}});assert.deepEqual(dismissals,[['a',1]]);
 p.openUpdate({currentTarget:{dataset:{key:'unknown'}}});assert.equal(navigation.length,3);
 const markup=read('pages/home/index.wxml');
 assert.match(markup,/<swiper class="home-campaigns"[^>]*wx:if="\{\{campaigns.length\}\}"/);
 assert.match(markup,/<view class="estimate-banner" bindtap="goEstimate"/);
 assert.ok(markup.indexOf('class="home-campaigns"')<markup.indexOf('class="home-updates surface"'));
 assert.ok(markup.indexOf('class="estimate-banner"')>markup.indexOf('class="updates-list"'));
 p.setData({notices:[],announcements:[]});p.refreshUpdates();assert.equal(p.data.homeUpdates.length,0);
 assert.match(markup,/class="updates-swiper"[^>]*vertical/);
 assert.match(markup,/autoplay="\{\{homeVisible && !sharePopupVisible && homeUpdates.length>1\}\}"/);
 assert.match(markup,/interval="5000"/);assert.match(markup,/wx:if="\{\{!updatesExpanded\}\}"/);
 p.data.homeVisible=true;p.onHide();assert.equal(p.data.homeVisible,false);
});
test('轮播期间刷新保持当前条目和展开状态，删除当前条目时回到有效索引',()=>{
 const {p}=page();p.setData({notices,announcements});p.refreshUpdates();
 p.changeUpdate({detail:{current:1}});p.toggleUpdates();assert.equal(p.data.updatesExpanded,true);
 p.setData({notices:[{id:'new',text:'工程师已提交成果'},...notices]});p.refreshUpdates();
 assert.equal(p.data.homeUpdates[p.data.updateIndex].key,'announcement:a:1');
 assert.equal(p.data.updateIndex,2);
 assert.equal(p.data.updatesExpanded,true);
 p.updateAnnouncements({detail:{items:[]}});assert.equal(p.data.updateIndex,0);
 p.toggleUpdates();assert.equal(p.data.updatesExpanded,false);
});
test('订单提醒轮询不会将旧账号或工程师身份下的响应显示到客户首页',async()=>{
 for(const change of ['account','role']){
  let release;const {p}=page(()=>new Promise(resolve=>release=resolve));
  const loading=p.loadNotices();
  if(change==='account')p.data.user={id:'other'};else p.data.role='ENGINEER';
  release(notices);await loading;assert.equal(p.data.notices.length,0);
 }
 const {p}=page(async()=>notices);await p.loadNotices();assert.equal(p.data.homeUpdates[0].id,'o');
});
function banner({embedded=true,request=async()=>({serverNow:new Date().toISOString(),items:announcements})}={}){
 let definition;const events=[],timeouts=[],intervals=new Map(),storage={user:{id:'u'}};
 vm.runInNewContext(read('components/announcement-banner/index.js'),{
  Component:c=>definition=c,require:()=>({request}),
  wx:{getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v},
  setInterval:(fn,ms)=>{intervals.set(ms,fn);return ms;},clearInterval:id=>intervals.delete(id),
  setTimeout:(fn,ms)=>{timeouts.push({fn,ms});return 1;},clearTimeout(){},
 });
 const b={...definition.methods,data:{...definition.data,embedded},setData:p=>Object.assign(b.data,p),triggerEvent:(name,data)=>events.push(data.items)};
 return {b,storage,events,timeouts,intervals};
}
test('嵌入首页的公告保留按账号关闭、修订重新提示及服务端时间到期移除，独立公告仍轮播',async()=>{
 let now=new Date(),revision=1;
 const h=banner({request:async()=>({serverNow:now.toISOString(),items:[{...announcements[0],revision,endsAt:new Date(now.getTime()+60000).toISOString()}]})});
 h.b.start();await h.b.load();assert.equal(h.events.at(-1).length,1);assert.equal(h.timeouts.length,0);
 h.b.dismiss('a',1);assert.deepEqual(Array.from(h.storage['announcement-dismissed:u']),['a:1']);
 assert.equal(h.events.at(-1).length,0);await h.b.load();assert.equal(h.events.at(-1).length,0);
 revision=2;await h.b.load();assert.equal(h.events.at(-1)[0].revision,2);
 // 模拟本地时钟滞后，组件以服务端偏移量判断有效期。
 h.b._offset=120000;h.intervals.get(1000)();assert.equal(h.events.at(-1).length,0);
 h.b.stop();assert.equal(h.intervals.size,0);
 const independent=banner({embedded:false,request:async()=>({serverNow:now.toISOString(),items:[{...announcements[0],endsAt:new Date(now.getTime()+60000).toISOString()}]})});
 independent.b.start();await independent.b.load();assert.ok(independent.timeouts.length>0);assert.equal(independent.events.length,0);independent.b.stop();
});
test('公告请求在离开页面或切换账号后返回，不把旧公告加入提醒栏',async()=>{
 for(const change of ['hide','account']){
  let release;const h=banner({request:()=>new Promise(resolve=>release=resolve)});h.b._active=true;
  const loading=h.b.load();
  if(change==='hide')h.b.stop();else h.storage.user={id:'other'};
  release({serverNow:new Date().toISOString(),items:[{...announcements[0],endsAt:new Date(Date.now()+60000).toISOString()}]});
  await loading;assert.equal(h.events.length,0);
 }
});
