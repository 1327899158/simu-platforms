'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let order,blocked=false,fail=false,inTx=false;
let sent=new Set();const messages=[],pushes=[];
mock('../src/db',{tx:async fn=>{
 const before=new Set(sent),length=messages.length;inTx=true;
 try{return await fn({execute:async(sql,args)=>{
  if(sql.startsWith('SELECT * FROM orders'))return [[order]];
  if(sql.startsWith('SELECT id FROM disputes')||sql.startsWith('SELECT id FROM refund_requests'))return [blocked?[{id:'d'}]:[]];
  if(sql.startsWith('INSERT IGNORE INTO delivery_reminders')){const key=JSON.stringify(args),exists=sent.has(key);sent.add(key);return [{affectedRows:exists?0:1}];}
  throw Error(sql);
 }});}catch(e){sent=before;messages.length=length;throw e;}finally{inTx=false;}
}});
mock('../src/services/chat-svc',{
 ensureConversation:async()=>({id:'conv',engineerId:'e'}),
 systemMessage:async(id,content,conn,meta)=>{assert.equal(inTx,true);assert.deepEqual(meta,{senderId:'e',actionOrderId:'o'});if(fail)throw Error('db failed');messages.push(content);return {msgId:messages.length};},
 publishSystemMessage:(...args)=>{assert.equal(inTx,false);pushes.push(args);},
});
mock('../src/services/engineer-level',{});
const {remind,reminderStage}=require('../src/services/auto-complete-svc');
const now=Date.now(),day=86400000;
const sample=remaining=>({status:'DELIVERED',deliveredAt:new Date(now-14*day+remaining).toISOString()});
test('提醒时间边界：3天和1天、已到期及已退出待验收状态',()=>{
 assert.equal(reminderStage(sample(3*day+1),now),null);
 assert.equal(reminderStage(sample(3*day),now),'ACCEPT_3D');
 assert.equal(reminderStage(sample(day+1),now),'ACCEPT_3D');
 assert.equal(reminderStage(sample(day),now),'ACCEPT_1D');
 assert.equal(reminderStage(sample(0),now),null);
 assert.equal(reminderStage({...sample(day),status:'COMPLETED'},now),null);
});
test('提醒按交付去重，仅客户产生未读；售后和事务失败不消耗提醒',async()=>{
 order=sample(2*day);fail=true;await assert.rejects(remind('o'));assert.equal(sent.size,0);assert.equal(pushes.length,0);
 fail=false;blocked=true;assert.equal(await remind('o'),false);assert.equal(sent.size,0);
 blocked=false;assert.equal(await remind('o'),true);assert.equal(await remind('o'),false);assert.match(messages[0],/3天/);
 // 同一交付，推进时钟进入1天阶段。
 const original=Date.now;Date.now=()=>now+1.5*day;
 try{assert.equal(await remind('o'),true);assert.equal(await remind('o'),false);assert.match(messages[1],/1天/);}finally{Date.now=original;}
 order=sample(2.5*day);assert.equal(await remind('o'),true);
 assert.equal(pushes.length,3);
 order=sample(-1);assert.equal(await remind('o'),false);
 order={...sample(day),status:'DISPUTING'};assert.equal(await remind('o'),false);
});
