'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('客户中间悬浮发布按钮，工程师导航保持原有四项',()=>{
 let component;const actions=[];
 vm.runInNewContext(read('miniapp/custom-tab-bar/index.js'),{Component:x=>component=x,wx:{getStorageSync:()=>({role:'CUSTOMER'}),navigateTo:x=>actions.push(x.url)},getCurrentPages:()=>[],getApp:()=>({globalData:{}}),require:()=>({isApproved:()=>true})});
 const ctx={data:{},setData(v){Object.assign(this.data,v);}};
 component.methods.syncTabBar.call(ctx,'CUSTOMER','/pages/home/index');
 assert.equal(ctx.data.tabs.length,5);assert.equal(ctx.data.tabs[2].publish,true);
 component.methods.switchTab.call(ctx,{currentTarget:{dataset:{path:'publish'}}});
 assert.equal(actions[0],'/pages/publish/index');
 component.methods.syncTabBar.call(ctx,'ENGINEER','/pages/home/index');
 assert.equal(ctx.data.tabs.length,4);assert.ok(!ctx.data.tabs.some(x=>x.publish));
});
test('新页面全部注册，模拟钱包不采集完整银行卡或调用真实打款',()=>{
 const config=JSON.parse(read('miniapp/app.json'));
 for(const p of ['wallet','bank-card','benefits'])assert.ok(config.pages.includes('pages/'+p+'/index'));
 assert.ok(config.subPackages.find(x=>x.root==='admin').pages.includes('pages/wallet/index'));
 const bank=read('miniapp/pages/bank-card/index.wxml');assert.match(bank,/maxlength="4"/);assert.doesNotMatch(bank,/data-key="cardNumber"/);
 const svc=read('server/src/services/demo-wallet-svc.js');assert.doesNotMatch(svc,/requestPayment|fetch\(|https\.request|transferTo|pay-svc/);
 assert.match(read('miniapp/pages/home/index.wxml'),/signin-float wx:if="{{role==='ENGINEER'}}"/);
});
test('拖动签到浮窗后不会误触导航',()=>{
 let c,navigations=0;vm.runInNewContext(read('miniapp/components/signin-float/index.js'),{Component:x=>c=x,wx:{setStorageSync(){},navigateTo(){navigations++;}},Date});
 const ctx={...c.methods};ctx.start({touches:[{clientX:0,clientY:0}]});ctx.move({touches:[{clientX:30,clientY:30}]});ctx.end();ctx.open();assert.equal(navigations,0);
 ctx._ignoreUntil=0;ctx.open();assert.equal(navigations,1);
});

