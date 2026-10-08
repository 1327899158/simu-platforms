'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../miniapp'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
function setup(request=async()=>({accepted:true})){const module={exports:{}},storage={};vm.runInNewContext(read('utils/invitation.js'),{module,require:()=>({request}),wx:{getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,removeStorageSync:k=>delete storage[k]}});return {svc:module.exports,storage};}
test('个人链接和小程序码均提取邀请码，登录前保存，绑定成功后清除',async()=>{
 for(const options of [{query:{invite:'1234567890abcdef'}},{scene:'invite%3D1234567890abcdef'}]){const calls=[],s=setup(async(...args)=>calls.push(args));s.svc.capture(options);assert.equal(s.storage['pending-invitation'].code,'1234567890abcdef');await s.svc.accept();assert.equal(calls[0][1],'/invitations/accept');assert.equal(s.storage['pending-invitation'],undefined);}
});
test('首次有效邀请码优先，网络失败保留待绑定邀请，过期丢弃',async()=>{
 const s=setup(async()=>{throw Error('network');});s.svc.capture({invite:'1234567890abcdef'});s.svc.capture({invite:'aaaaaaaaaaaaaaaa'});assert.equal(s.storage['pending-invitation'].code,'1234567890abcdef');await s.svc.accept();assert(s.storage['pending-invitation']);s.storage['pending-invitation'].expiresAt=0;await s.svc.accept();assert.equal(s.storage['pending-invitation'],undefined);
});
test('支付抵扣开关按可用余额及订单金额封顶，冻结时保留本单数额',()=>{
 let c;vm.runInNewContext(read('components/coin-deduction/index.js'),{Component:x=>c=x,require:()=>({})});const events=[],p={...c.methods,data:{...c.data,amountFen:1900,balance:2500,locked:false,heldCoins:0},setData(x){Object.assign(this.data,x);},triggerEvent:(name,e)=>events.push(e.coins)};
 p.toggle({detail:{value:true}});assert.equal(p.data.coins,1900);assert.equal(p.data.deductionText,'19.00');p.update();assert.equal(events.length,1);p.data.locked=true;p.data.heldCoins=1200;p.data.balance=0;p.update();assert.equal(p.data.coins,1200);assert.equal(events.length,1);
});
