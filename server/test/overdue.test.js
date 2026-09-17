const test=require('node:test'),assert=require('node:assert/strict');
let order,term,pending,breach,reminders,messages,refunds,blocking,payment=true;
function reset(age=49){order={id:'o',engineerId:'e',customerId:'c',days:1,status:'IN_PROGRESS',paidAt:new Date(Date.now()-(age+24)*3600000),finalAmountFen:12345};term={deadline:new Date(Date.now()-age*3600000)};pending=null;breach=null;reminders=[];messages=[];refunds=0;blocking=false;payment=true;}
async function execute(s,a){
 if(s.startsWith('SELECT o.*'))return [[order]];
 if(s.startsWith('INSERT IGNORE INTO order_delivery_terms'))return [{affectedRows:0}];
 if(s.startsWith('SELECT * FROM order_delivery_terms'))return [[term]];
 if(s.startsWith('SELECT id FROM delivery_extensions'))return [[pending].filter(Boolean)];
 if(s.startsWith('INSERT IGNORE INTO delivery_reminders')){const exists=reminders.some(x=>x.kind===a[2]);if(!exists)reminders.push({kind:a[2]});return [{affectedRows:exists?0:1}];}
 if(s.startsWith('SELECT b.disputeId')){assert.match(s,/d\.id COLLATE utf8mb4_unicode_ci\s*=\s*b\.disputeId COLLATE utf8mb4_unicode_ci/);return [[breach].filter(Boolean)];}
 if(s.startsWith('SELECT id FROM disputes')||s.startsWith('SELECT id FROM refund_requests'))return [[blocking?{id:'other'}:null].filter(Boolean)];
 if(s.startsWith('SELECT id FROM payments'))return [[payment?{id:'p'}:null].filter(Boolean)];
 if(s.startsWith('INSERT INTO disputes')){refunds++;assert.equal(a[4],12345);return [{affectedRows:1}];}
 if(s.startsWith('INSERT INTO delivery_breaches')){breach={disputeId:a[2],refundStatus:'PENDING'};return [{affectedRows:1}];}
 if(s.startsWith('UPDATE orders')){order.status='CLOSED';return [{affectedRows:1}];}
 if(s.startsWith('SELECT kind'))return [reminders];
 throw Error(s);
}
let sweepSql;
require.cache[require.resolve('../src/db')]={exports:{tx:fn=>fn({execute}),query:async sql=>{sweepSql=sql;return [];}}};
require.cache[require.resolve('../src/services/chat-svc')]={exports:{ensureConversation:async()=>({id:'conv'}),systemMessage:async(id,text)=>{messages.push(text);return {msgId:messages.length};},publishSystemMessage(){}}};
const {inspect,eligible,sweep}=require('../src/services/overdue-svc');
test('逾期扫描兼容交付期限表与订单表排序规则不同',async()=>{
 await sweep();
 assert.match(sweepSql,/t\.orderId COLLATE utf8mb4_unicode_ci\s*=\s*o\.id COLLATE utf8mb4_unicode_ci/);
});
test('48小时边界、待审批暂停、交付和非履约状态不自动判定',()=>{
 const now=Date.now(),o={status:'IN_PROGRESS'};
 assert.equal(eligible(o,now-48*3600000,false,now),true);
 assert.equal(eligible(o,now-48*3600000+1,false,now),false);
 assert.equal(eligible(o,now-49*3600000,true,now),false);
 assert.equal(eligible({...o,deliveredAt:new Date()},now-49*3600000,false,now),false);
 assert.equal(eligible({status:'DISPUTING'},now-49*3600000,false,now),false);
});
test('提醒及催单防重；只有客户可催单',async()=>{
 reset(6);const customer={id:'c',role:'CUSTOMER'};
 await inspect('o',customer,true);await inspect('o',customer,true);
 assert.equal(messages.length,2);assert.equal(reminders.length,2);assert.equal(refunds,0);
 await assert.rejects(inspect('o',{id:'e',role:'ENGINEER'},true),e=>e.status===403);
 await assert.rejects(inspect('o',{id:'stranger',role:'CUSTOMER'}),e=>e.status===403);
});
test('延期被拒后不重计48小时，生成全额记录且不重复',async()=>{
 reset();pending={id:'extension'};await inspect('o');assert.equal(refunds,0);
 pending=null;const r=await inspect('o');assert.equal(refunds,1);assert.equal(order.status,'CLOSED');assert.equal(r.breach.refundStatus,'PENDING');
 await inspect('o');assert.equal(refunds,1);
});
test('已有售后或缺少匹配支付记录不重复处理资金',async()=>{
 reset();blocking=true;await inspect('o');assert.equal(refunds,0);
 reset();payment=false;await inspect('o');assert.equal(refunds,0);
});
