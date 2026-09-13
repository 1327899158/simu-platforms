'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let order,term,items;
async function execute(sql,a){
 if(sql.startsWith('SELECT o.*'))return [[order]];
 if(sql.startsWith('INSERT IGNORE')){term=term||{deadline:a[1]};return [{affectedRows:1}];}
 if(sql.startsWith('SELECT * FROM order_delivery_terms'))return [[term]];
 if(sql.startsWith('SELECT id FROM delivery_extensions'))return [[items.find(x=>x.status==='PENDING')].filter(Boolean)];
 if(sql.startsWith('INSERT INTO delivery_extensions')){items.push({id:a[0],orderId:a[1],engineerId:a[2],days:a[3],reason:a[4],status:'PENDING',oldDeadline:a[5],proposedDeadline:a[6]});return [{affectedRows:1}];}
 if(sql.startsWith('SELECT * FROM delivery_extensions WHERE id'))return [[items.find(x=>x.id===a[0]&&x.orderId===a[1])].filter(Boolean)];
 if(sql.startsWith('UPDATE order_delivery_terms')){term.deadline=a[0];return [{affectedRows:1}];}
 if(sql.startsWith('UPDATE delivery_extensions')){items.find(x=>x.id===a[1]).status=a[0];return [{affectedRows:1}];}
 if(sql.startsWith('SELECT deadline'))return [[term]];
 if(sql.startsWith('SELECT * FROM delivery_extensions WHERE orderId'))return [items];
 throw Error(sql);
}
require.cache[require.resolve('../src/db')]={exports:{tx:async fn=>{const snapshot=structuredClone({term,items});try{return await fn({execute});}catch(e){term=snapshot.term;items=snapshot.items;throw e;}}}};
const {run,authorize,initialDeadline}=require('../src/services/delivery-svc');
const engineer={id:'e',role:'ENGINEER'},customer={id:'c',role:'CUSTOMER'};
test('期限以付款及成交工期为准，非法原始数据不会猜测期限',()=>{
 assert.equal(initialDeadline({paidAt:'2026-09-10T12:00:00Z',days:3}).toISOString(),'2026-09-13T12:00:00.000Z');
 assert.throws(()=>initialDeadline({paidAt:null,days:3}));
 assert.throws(()=>initialDeadline({paidAt:'invalid',days:3}));
});
test('延期权限、待审批唯一、同意累加、拒绝不改期限、重复审批拦截',async()=>{
 order={id:'o',customerId:'c',engineerId:'e',status:'IN_PROGRESS',paidAt:'2026-09-10T12:00:00Z',days:3};term=null;items=[];
 await assert.rejects(run({id:'other',role:'ENGINEER'},'o','apply',{days:1,reason:'原因'}),e=>e.status===403);
 await assert.rejects(run(customer,'o','apply',{days:1,reason:'原因'}),e=>e.status===403);
 await assert.rejects(run(engineer,'o','apply',{days:0,reason:'原因'}),e=>e.status===400);
 const before=(await run(customer,'o')).deadline;
 await run(engineer,'o','apply',{days:2,reason:'模型需进一步校准'});const first=items[0].id;
 assert.equal(new Date(term.deadline).getTime(),new Date(before).getTime());
 await assert.rejects(run(engineer,'o','apply',{days:1,reason:'又申请'}),e=>e.status===409);
 await assert.rejects(run(engineer,'o','respond',{id:first,decision:'APPROVED'}),e=>e.status===403);
 await run(customer,'o','respond',{id:first,decision:'APPROVED'});
 assert.equal(new Date(term.deadline).toISOString(),'2026-09-15T12:00:00.000Z');
 await assert.rejects(run(customer,'o','respond',{id:first,decision:'APPROVED'}),e=>e.status===409);
 await run(engineer,'o','apply',{days:1,reason:'继续申请'});
 await run(customer,'o','respond',{id:items[1].id,decision:'REJECTED'});
 assert.equal(new Date(term.deadline).toISOString(),'2026-09-15T12:00:00.000Z');
 for(const status of ['DELIVERED','DISPUTING','REFUND_PENDING','COMPLETED','CANCELLED']){order.status=status;assert.throws(()=>authorize(order,engineer,'apply'),e=>e.status===409);}
});
test('倒计时分钟边界、逾期及跨天',()=>{
 const {countdown}=require('../../miniapp/utils/delivery-clock');const now=Date.parse('2026-09-12T00:00:00Z');
 assert.equal(countdown(new Date(now+60001),now),'剩余 0天 0小时 2分钟');
 assert.equal(countdown(new Date(now+60000),now),'剩余 0天 0小时 1分钟');
 assert.equal(countdown(new Date(now-60000),now),'已逾期 0天 0小时 1分钟');
 assert.equal(countdown(new Date(now+86400000),now),'剩余 1天 0小时 0分钟');
});
