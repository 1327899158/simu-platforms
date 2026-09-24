'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let invoice={id:'inv',status:'PLATFORM_REQUESTED',orderId:'order'},audit=[],messages=[],sqls=[];
mock('../src/db',{
 query:async(sql,args)=>{sqls.push([sql,args]);return [];},queryOne:async()=>({count:0,amountFen:0}),
 tx:async fn=>fn({execute:async(sql,args=[])=>{
  if(sql.includes('FROM orders o'))return [[{id:'order',customerId:'customer',engineerId:'engineer',status:'COMPLETED'}]];
  if(sql.includes('FROM invoice_requests'))return [[{...invoice}]];
  if(sql.includes("SET status='RETURNED'")){invoice.status='RETURNED';invoice.reason=args[0];return [{}];}
  if(sql.includes("SET invoiceTitle=")){invoice.status='PLATFORM_REQUESTED';invoice.title=args[0];return [{}];}
  throw Error(sql);
 }})
});
mock('../src/lib/admin-mw',{requireAdmin:async req=>{if(!req.admin)throw Object.assign(Error('forbidden'),{status:403});return {admin:{id:'admin'}};},writeAdminAudit:async(_r,_a,action)=>audit.push(action)});
mock('../src/lib/auth-mw',{requireCustomer:async()=>({id:'customer'})});
mock('../src/services/chat-svc',{systemMessageForOrder:async(...args)=>messages.push(args)});
const http=require('../src/lib/http'),router=http.createRouter();
require('../src/routes/invoices').register(router);require('../src/routes/admin-finance').register(router);
const {period}=require('../src/routes/admin-finance');
async function call(method,url,body={},admin=true){const route=router.match(method,url),req=Readable.from([Buffer.from(JSON.stringify(body))]);req.headers={};req.admin=admin;let result;await route.handler(req,{writeHead(){},end(s){result=JSON.parse(s).data;}},route.params,new URLSearchParams());return result;}
test('财务日期按北京时间自然日、周一和自然月统计',()=>{
 const now=new Date('2026-09-27T16:30:00Z');
 for(const range of ['today','week']){const d=period(new URLSearchParams({range}),now);assert.equal(d.start,'2026-09-28');assert.equal(d.from,'2026-09-27 16:00:00');assert.equal(d.until,'2026-09-28 16:00:00');}
 assert.equal(period(new URLSearchParams(),now).start,'2026-09-01');
 const leap=period(new URLSearchParams({range:'custom',start:'2024-02-29',end:'2024-02-29'}));assert.equal(leap.until,'2024-02-29 16:00:00');
 for(const [start,end] of [['2026-02-30','2026-03-01'],['2026-09-03','2026-09-01'],['2020-01-01','2026-01-01']])assert.throws(()=>period(new URLSearchParams({range:'custom',start,end})),e=>e.status===400);
});
test('发票退回有权限与状态限制，必填原因；客户修改后回平台队列并通知',async()=>{
 await assert.rejects(call('POST','/api/admin/invoices/inv/return',{reason:'抬头错误'},false),e=>e.status===403);
 await assert.rejects(call('POST','/api/admin/invoices/inv/return',{reason:''}),e=>e.status===400);
 await call('POST','/api/admin/invoices/inv/return',{reason:'请核对抬头'});assert.equal(invoice.status,'RETURNED');assert.ok(audit.includes('INVOICE_RETURN'));assert.equal(messages.length,1);
 await assert.rejects(call('POST','/api/admin/invoices/inv/return',{reason:'再次退回'}),e=>e.status===409);
 const result=await call('POST','/api/orders/order/invoice-request',{invoiceTitle:'修改后的公司',buyerType:'BUSINESS',taxNumber:'123456789012345678',invoiceType:'NORMAL',invoiceFormat:'DIGITAL'});
 assert.equal(result.id,'inv');assert.equal(result.status,'PLATFORM_REQUESTED');assert.equal(invoice.title,'修改后的公司');assert.equal(messages.length,2);
 await assert.rejects(call('POST','/api/orders/order/invoice-request',{invoiceTitle:'重复提交'}),e=>e.status===409);
});
test('大额队列严格超过5000元，报表不虚构平台收入',async()=>{
 const d=await call('GET','/api/admin/finance/overview');assert.equal(d.incomeFen,null);
 assert.ok(sqls.some(([sql])=>sql.includes('w.amountFen>500000')));
 const daily=sqls.find(([sql])=>sql.includes('GROUP BY day'));assert.equal(daily[1].length,2);assert.ok(daily[0].includes('paidAt<?'));
});
const {promotionSummary}=require('../src/routes/admin-finance');
test('推广来源分别按19元与29元测算，不将选择次数计为已收款',()=>{
 const result=promotionSummary([{promotion:'EXPOSURE',count:'3'},{promotion:'URGENT',count:'2'}]);
 assert.equal(result[0].estimatedFen,5700);assert.equal(result[1].estimatedFen,5800);
 assert.equal(result[0].receivedFen,null);assert.equal(result[1].paymentStatus,'NOT_INTEGRATED');
 assert.equal(promotionSummary([])[0].count,0);assert.equal(promotionSummary([])[1].estimatedFen,0);
});
