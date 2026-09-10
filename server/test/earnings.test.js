'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let statements=[];
mock('../src/db',{
 queryOne:async(sql,args)=>{statements.push({sql,args});return {completedFen:'10000',completedCount:'1',monthFen:'10000',activeFen:'20000',heldFen:'30000'};},
 query:async(sql,args)=>{statements.push({sql,args});return sql.includes('GROUP BY')?[]:Array.from({length:21},(_,i)=>({id:'o'+i,status:'COMPLETED',finalAmountFen:10000}));}
});
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});
mock('../src/config',{config:{paymentMode:'mock'}});
const router=require('../src/lib/http').createRouter();
const {register,months}=require('../src/routes/earnings');register(router);
async function call(role,search=''){const r=router.match('GET','/api/engineers/earnings');let data;await r.handler({user:{id:'e',role}},{writeHead(){},end(raw){data=JSON.parse(raw).data;}},r.params,new URLSearchParams(search));return data;}
test('收益仅本人工程师可查，采用成功支付订单且不重复连接支付记录',async()=>{
 await assert.rejects(call('CUSTOMER'),e=>e.status===403);
 const result=await call('ENGINEER');
 assert.equal(result.summary.completedFen,10000);
 assert.equal(result.items.length,20);assert.equal(result.nextOffset,20);
 assert.equal(result.trend.length,6);assert.ok(result.trend.every(x=>x.amountFen===0));
 for(const {sql,args} of statements){
  assert.match(sql,/q.engineerId=\?/);assert.ok(args.includes('e'));
  assert.match(sql,/EXISTS \(SELECT 1 FROM payments/);assert.match(sql,/p.status='SUCCESS'/);
  assert.match(sql,/o.deletedAt IS NULL/);
 }
 assert.equal(result.paymentMode,'mock');
 assert.match(result.basis,/不代表到账/);
});
test('收益月份使用北京时间，跨年正确；分页参数防注入',async()=>{
 assert.deepEqual(months(new Date('2026-12-31T16:01:00Z')),['2026-08','2026-09','2026-10','2026-11','2026-12','2027-01']);
 await assert.rejects(call('ENGINEER','offset=-1'),e=>e.status===400);
 await assert.rejects(call('ENGINEER','offset=0;DROP'),e=>e.status===400);
});

