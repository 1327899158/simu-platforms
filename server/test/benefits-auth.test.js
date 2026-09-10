'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let calls=0;
mock('../src/db',{query:async()=>[]});
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});
mock('../src/lib/admin-mw',{requireAdmin:async()=>{throw Object.assign(Error('forbidden'),{status:403});}});
mock('../src/services/demo-wallet-svc',{snapshot:async id=>{calls++;return {owner:id};},withdraw:async()=>{calls++;}});
mock('../src/services/benefits-svc',{assets:async id=>({owner:id})});
const router=require('../src/lib/http').createRouter();require('../src/routes/benefits').register(router);
async function call(method,path,role){const r=router.match(method,path);let data;await r.handler({user:{id:'owner',role}},{writeHead(){},end(raw){data=JSON.parse(raw).data;}},r.params,new URLSearchParams('userId=other'));return data;}
test('钱包只对工程师本人开放，查询参数不能冒用其他用户',async()=>{
 await assert.rejects(call('GET','/api/wallet','CUSTOMER'),e=>e.status===403);
 await assert.rejects(call('POST','/api/wallet/withdraw','CUSTOMER'),e=>e.status===403);
 const result=await call('GET','/api/wallet','ENGINEER');assert.equal(result.owner,'owner');assert.equal(calls,1);
});
test('卡券支持双方，模拟管理接口仍要求独立管理权限',async()=>{
 for(const role of ['CUSTOMER','ENGINEER'])assert.equal((await call('GET','/api/benefits',role)).owner,'owner');
 await assert.rejects(call('GET','/api/admin/wallet','ENGINEER'),e=>e.status===403);
 await assert.rejects(call('POST','/api/admin/wallet/credit','ENGINEER'),e=>e.status===403);
});

