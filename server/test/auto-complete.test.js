'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let order,blocked=false,messages=0,pushes=0,refreshed=0;
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
const conn={execute:async(sql,args)=>{
 if(sql.startsWith('SELECT * FROM orders'))return [[order]];
 if(sql.startsWith('SELECT id FROM disputes')||sql.startsWith('SELECT id FROM refund_requests'))return [blocked?[{id:'d'}]:[]];
 if(sql.startsWith('UPDATE orders')){
  assert.match(sql,/INTERVAL 14 DAY/);assert.match(sql,/status='DELIVERED'/);
  const valid=order.status==='DELIVERED'&&new Date(order.deliveredAt).getTime()<=Date.now()-14*86400000;
  if(valid)order.status='COMPLETED';return [{affectedRows:valid?1:0}];
 }throw Error(sql);
}};
mock('../src/db',{tx:fn=>fn(conn)});
mock('../src/services/chat-svc',{
 ensureConversation:async()=>({id:'c'}),systemMessage:async()=>{messages++;return {msgId:1};},publishSystemMessage:()=>{pushes++;},
});
mock('../src/services/engineer-level',{refreshForOrder:async()=>{refreshed++;}});
const {deadline,complete}=require('../src/services/auto-complete-svc');
test('14天截止时间与状态匹配，重新交付重新计算',()=>{
 assert.equal(deadline({status:'DELIVERED',deliveredAt:'2026-09-01 08:00:00'}),'2026-09-15T08:00:00.000Z');
 assert.equal(deadline({status:'DELIVERED',deliveredAt:'2026-09-05T08:00:00Z'}),'2026-09-19T08:00:00.000Z');
 assert.equal(deadline({status:'IN_PROGRESS',deliveredAt:'2026-09-01'}),null);
 assert.equal(deadline({status:'DELIVERED',deliveredAt:null}),null);
});
test('未满14天不验收，售后阻止自动收货；到期只完成一次并通知及刷新等级',async()=>{
 order={status:'DELIVERED',deliveredAt:new Date(Date.now()-13*86400000).toISOString()};
 assert.equal(await complete('o'),false);
 order.deliveredAt=new Date(Date.now()-14*86400000-1000).toISOString();blocked=true;
 assert.equal(await complete('o'),false);blocked=false;
 assert.equal(await complete('o'),true);assert.equal(order.status,'COMPLETED');
 assert.equal(await complete('o'),false);assert.equal(messages,1);assert.equal(pushes,1);assert.equal(refreshed,1);
 for(const status of ['DISPUTING','REFUND_PENDING','CANCELLED','IN_PROGRESS']){order.status=status;assert.equal(await complete('o'),false);}
});
