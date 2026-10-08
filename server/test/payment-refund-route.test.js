'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>require.cache[require.resolve(p)]={exports,loaded:true};
let caller='customer',missing=false,queries=0;
mock('../src/config',{config:{paymentMode:'mock'}});
mock('../src/services/pay-svc',{});
mock('../src/services/payment-notify-v3',{handler:()=>()=>{}});
mock('../src/lib/auth-mw',{requireUser:async()=>({id:caller})});
mock('../src/db',{queryOne:async sql=>{
 assert.match(sql,/LEFT JOIN quotes q/);assert.match(sql,/q\.engineerId/);assert.match(sql,/deletedAt IS NULL/);
 return missing?null:{customerId:'customer',engineerId:'selected-engineer'};
},query:async()=>{queries++;return[{id:'r',status:'PROCESSING',cashRefundFen:4500,coinRefund:500,lastError:undefined}];}});
const router=require('../src/lib/http').createRouter();require('../src/routes/payments').register(router);
async function call(){let result;const r=router.match('GET','/api/orders/o/refunds');await r.handler({}, {writeHead(){},end:s=>result=JSON.parse(s)},r.params);return result.data;}
test('退款进度只有客户和已选中工程师可读，按现金部分展示且不泄露内部错误',async()=>{
 for(const id of ['customer','selected-engineer']){caller=id;const r=await call();assert.equal(r.items[0].cashRefundText,'45.00');assert.equal(r.items[0].statusText,'退款处理中');assert.equal(r.items[0].coinRefund,500);assert.equal(r.items[0].lastError,undefined);}
});
test('其他报价工程师、无关用户及已删除订单不能读取退款信息',async()=>{
 for(const id of ['other-engineer','stranger']){caller=id;const n=queries;await assert.rejects(call(),e=>e.status===404);assert.equal(queries,n);}
 caller='customer';missing=true;await assert.rejects(call(),e=>e.status===404);
});
