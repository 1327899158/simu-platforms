'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const DAY=86400000;let row,blocked,referenced,removed,logged,notices,files,fail,completedAt;
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
mock('../src/config',{config:{cloudbaseEnv:'test-env'}});
mock('../src/services/chat-svc',{ensureConversation:async()=>({id:'conv'}),systemMessage:async()=>{notices++;return {msgId:1};},publishSystemMessage(){}});
mock('../src/tcb',{getStorage:()=>({deleteFile:async()=>{removed++;return fail?{code:'FAILED'}:{fileList:[{fileID:'cloud://test-env.bucket/uploads/u/o/f',code:'SUCCESS'}]};}})});
mock('../src/db',{query:async()=>[],tx:async fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT o.*'))return [[{id:'o',status:'COMPLETED',completedAt,customerId:'u',engineerId:'e'}]];
 if(sql.startsWith('SELECT id FROM disputes'))return [blocked?[{id:'d'}]:[]];
 if(sql.startsWith('SELECT id FROM service_tickets'))return [[]];
 if(sql.startsWith('DELETE FROM order_file_retention')){row=null;return [{}];}
 if(sql.startsWith('SELECT f.*'))return [files];
 if(sql.startsWith('SELECT * FROM order_file_retention'))return [[row].filter(Boolean)];
 if(sql.startsWith('INSERT INTO order_file_retention')){row={completedAt:a[1],deleteAfter:a[2]};return [{}];}
 if(sql.startsWith('UPDATE order_file_retention')){row[sql.includes('notified7At')?'notified7At':'notified1At']=a[0];row.deleteAfter=a[1];return [{}];}
 if(sql.startsWith('SELECT fileId'))return [referenced?[{fileId:'f'}]:[]];
 if(sql.startsWith('INSERT INTO file_cleanup_log')){logged++;return [{}];}
 throw Error(sql);
}})});
const svc=require('../src/services/file-retention');
function reset(){row=null;completedAt=new Date(Date.now()-100*DAY);blocked=referenced=fail=false;removed=logged=notices=0;files=[{id:'f',fileID:'cloud://test-env.bucket/uploads/u/o/f',name:'模型'}];}
test('保留90天，历史订单完整7天，停机错过1天通知时不直接删除',()=>{
 const now=Date.now();assert.equal(+svc.plan(new Date(now-100*DAY),now),now+7*DAY);
 assert.equal(+svc.plan(new Date(now),now),now+90*DAY);
 assert.equal(svc.action({deleteAfter:new Date(now-DAY),notified7At:new Date(now-8*DAY)},now),'NOTICE1');
 assert.equal(svc.action({deleteAfter:new Date(now-DAY),notified7At:new Date(now-8*DAY),notified1At:new Date(now)},now),'WAIT');
});
test('历史单先通知，重复扫描不重复通知；售后暂停并重置提醒',async()=>{
 reset();await svc.processOrder('o');assert.equal(notices,1);assert.equal(removed,0);await svc.processOrder('o');assert.equal(notices,1);
 blocked=true;await svc.processOrder('o');assert.equal(row,null);assert.equal(removed,0);
});
test('引用文件保留，云删除失败不记成功，成功后保留清理记录',async()=>{
 reset();row={completedAt:new Date(Date.now()-100*DAY),deleteAfter:new Date(Date.now()-DAY),notified7At:new Date(Date.now()-8*DAY),notified1At:new Date(Date.now()-2*DAY)};
 // 使用固定时钟保证完单时间相同。
 const now=Date.now(),original=Date.now;Date.now=()=>now;row.completedAt=completedAt;
 try{referenced=true;await svc.processOrder('o');assert.equal(removed,0);
 referenced=false;fail=true;await assert.rejects(svc.processOrder('o'));assert.equal(logged,0);
 fail=false;await svc.processOrder('o');assert.equal(logged,1);
 }finally{Date.now=original;}
});
