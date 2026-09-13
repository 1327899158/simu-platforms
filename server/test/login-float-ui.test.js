const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'../../miniapp',p),'utf8');
test('登录401保留页面，业务401仍清理身份并跳登录',async()=>{
 const calls=[],module={exports:{}};
 vm.runInNewContext(read('utils/request.js'),{module,exports:module.exports,require:()=>({BASE_URL:'https://test'}),setTimeout:fn=>fn(),wx:{getStorageSync:()=>'',request:o=>o.success({statusCode:401,data:{code:40100,message:'账号或密码错误'}}),removeStorageSync:k=>calls.push(k),reLaunch:o=>{calls.push('navigate');o.complete();},showToast:()=>calls.push('toast')}});
 await assert.rejects(module.exports.request('POST','/auth/login',{}, {silent:true,redirectOnUnauthorized:false}),e=>e.message==='账号或密码错误'&&e.statusCode===401);
 assert.deepEqual(calls,[]);
 await assert.rejects(module.exports.request('GET','/me'),e=>e.statusCode===401);
 assert.deepEqual(calls,['user','sessionToken','devOpenid','navigate']);
 assert.match(read('utils/auth.js'),/\/auth\/login'[^\n]+redirectOnUnauthorized: false/);
});
test('签到吸附最近边缘、位置越界及重复吸附同侧',()=>{
 const {snapPosition}=require('../../miniapp/utils/signin-position');
 assert.deepEqual(snapPosition(375,600,{x:20,y:180}),{x:8,y:180});
 assert.deepEqual(snapPosition(375,600,{x:220,y:180}),{x:291,y:180});
 assert.deepEqual(snapPosition(375,600,{x:999,y:999}),{x:291,y:534});
 assert.deepEqual(snapPosition(320,500,{x:-20,y:-20}),{x:8,y:0});
 let c,saved;vm.runInNewContext(read('components/signin-float/index.js'),{require:()=>({snapPosition}),Component:x=>c=x,Date,wx:{setStorageSync:(k,v)=>saved=v}});
 const ctx={...c.methods,data:{width:375,height:600,x:291,y:180},setData(v,done){Object.assign(this.data,v);if(done)done();}};
 ctx.start({touches:[{clientX:320,clientY:200}]});ctx.move({touches:[{clientX:250,clientY:200}]});ctx.change({detail:{x:220,y:180}});ctx.end();
 assert.equal(ctx.data.x,291);assert.equal(saved.x,291);assert.equal(ctx.data.y,180);
});
