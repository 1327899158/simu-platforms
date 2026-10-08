'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../miniapp');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function freshSession(){const module={exports:{}};vm.runInNewContext(read('utils/login-share.js'),{module});return module.exports;}
const invite={id:'invite',action:'SHARE',title:'邀请好友赚仿真币',content:'好友注册得50币，首单完成再得250币。'};
function home({request=async()=>[invite],session=freshSession(),user={id:'u',role:'CUSTOMER'}}={}){
 let page;const track={stops:0,observes:0,stop(){this.stops++;},observe(){this.observes++;}};
 vm.runInNewContext(read('pages/home/index.js'),{Page:p=>page=p,require:name=>{
  if(name.endsWith('/auth'))return {getUser:()=>user,ensureLogin:()=>user};
  if(name.endsWith('/request'))return {request};
  if(name.endsWith('/login-share'))return session;
  if(name.endsWith('/exposure-tracker'))return track;
  return {};
 },clearInterval(){},wx:{}});
 page.data={...page.data,user};page._exposureActive=true;
 page.setData=(patch,done)=>{Object.assign(page.data,patch);if(done)done();};
 return {page,session,track,user};
}
test('缓存登录首次进入首页弹出，关闭和切换页面后同次登录不重复展示',async()=>{
 let calls=0;const {page}=home({request:async()=>{calls++;return[invite];}});
 await page.loadSharePopup('u');assert.equal(page.data.sharePopupVisible,true);
 page.closeSharePopup();await page.loadSharePopup('u');assert.equal(page.data.sharePopupVisible,false);assert.equal(calls,2);
 page.onHide();page._exposureActive=true;await page.loadSharePopup('u');assert.equal(calls,2);
});
test('相同账号重新登录再次弹出，冷启动重新创建会话也再次弹出',async()=>{
 const {page,session}=home();await page.loadSharePopup('u');page.closeSharePopup();
 session.start('u');await page.loadSharePopup('u');assert.equal(page.data.sharePopupVisible,true);
 const next=home();await next.page.loadSharePopup('u');assert.equal(next.page.data.sharePopupVisible,true);
});
test('活动下线和网络失败不显示，失败后重新进入首页可以重试',async()=>{
 const absent=home({request:async()=>[]});await absent.page.loadSharePopup('u');assert.equal(absent.page.data.sharePopupVisible,false);
 let fail=true;const {page}=home({request:async()=>{if(fail)throw Error('offline');return[invite];}});
 await page.loadSharePopup('u');assert.equal(page.data.sharePopupVisible,false);fail=false;
 await page.loadSharePopup('u');assert.equal(page.data.sharePopupVisible,true);
});
test('请求返回前离开首页、退出或切换账号，不展示旧账号弹窗',async()=>{
 for(const change of ['hide','logout','switch']){
  let release;const h=home({request:()=>new Promise(resolve=>release=resolve)}),pending=h.page.loadSharePopup('u');
  if(change==='hide')h.page.onHide();else if(change==='logout')h.session.start(null);else{h.session.start('other');h.page.data.user={id:'other'};}
  release([invite]);await pending;assert.equal(h.page.data.sharePopupVisible,false);
 }
});
test('分享按钮调起分享卡片并关闭弹窗，未请求发币；工程师弹窗期间暂停曝光统计',async()=>{
 const requests=[],h=home({request:async(m,url)=>{requests.push([m,url]);return url==='/invitations'?{sharePath:'/pages/guest-home/index?invite=1234567890abcdef'}:[invite];}});
 h.page.data.canTakeOrders=true;await h.page.loadSharePopup('u');assert.equal(h.track.stops,1);
 const card=h.page.onShareAppMessage({from:'button',target:{id:'login-invite-share'}});
 assert.equal(card.title,invite.title);assert.equal(card.path,'/pages/guest-home/index?invite=1234567890abcdef');assert.equal(h.page.data.sharePopupVisible,false);
 assert.equal(h.track.observes,1);assert.equal(requests.length,2);assert.equal(requests[0][0],'GET');
 const markup=read('pages/home/index.wxml');assert.match(markup,/id="login-invite-share"[^>]*open-type="share"/);assert.match(markup,/关闭分享弹窗/);assert.match(markup,/分享本身不发币/);
});
test('微信、密码、手机登录与注册均开启新弹窗会话，资料刷新不再次触发，失败不触发',async()=>{
 const session=freshSession(),storage={},module={exports:{}};let fail=false;
 vm.runInNewContext(read('utils/auth.js'),{module,require:name=>name==='./invitation'?{accept:async()=>{}}:name==='./login-share'?session:name==='./request'?{request:async()=>{if(fail)throw Error('login failed');return {user:{id:'u'},token:'token'};}}:{},wx:{login:o=>o.success(),setStorageSync:(k,v)=>storage[k]=v,getStorageSync:k=>storage[k],removeStorageSync:k=>delete storage[k],reLaunch(){}}});
 const auth=module.exports;
 for(const login of [()=>auth.login(),()=>auth.loginByUsername('123456','password'),()=>auth.loginByPhone('13800000000','123456'),()=>auth.registerByPhone('123456','13800000000','password','123456')]){
  await login();const ticket=session.pending('u');assert.ok(ticket);assert.equal(session.consume(ticket),true);
  auth.saveUser({id:'u',nickname:'资料已更新'});await auth.refreshUser();assert.equal(session.pending('u'),null);
 }
 fail=true;await assert.rejects(auth.loginByUsername('123456','bad'));assert.equal(session.pending('u'),null);
 fail=false;const previous=session.pending('other');await auth.logout();assert.equal(session.consume(previous),false);
});
test('邀请弹窗遮挡的曝光卡片不计数，关闭后恢复可见统计',async()=>{
 const module={exports:{}};let callback,n=0,created=0;
 vm.runInNewContext(read('utils/exposure-tracker.js'),{module,require:()=>({request:async()=>n++})});
 const page={_exposureActive:true,data:{sharePopupVisible:true,exposures:[{id:'o'}]},createIntersectionObserver(){created++;return {relativeToViewport(){return this;},observe(s,fn){callback=fn;},disconnect(){}};}};
 module.exports.observe(page);assert.equal(created,0);
 page.data.sharePopupVisible=false;module.exports.observe(page);page.data.sharePopupVisible=true;
 await callback({intersectionRatio:1,dataset:{id:'o',token:'token'}});assert.equal(n,0);
 page.data.sharePopupVisible=false;await callback({intersectionRatio:1,dataset:{id:'o',token:'token'}});assert.equal(n,1);
});
