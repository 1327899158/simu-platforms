'use strict';
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let relation,conv,messages,published,inTx,failMessage,directs;
async function execute(sql,p){
 if(sql.startsWith('SELECT r.* FROM cooperation_relations'))return [relation?.status==='ACTIVE'?[{...relation,terms:{minAmountFen:100}}]:[]];
 if(sql.startsWith('INSERT INTO direct_demands')){directs.push(p[0]);return [{}];}
 if(sql.startsWith('SELECT u.id'))return [[{id:'e'}]];
 if(sql.includes('FROM cooperation_settings'))return [[{enabled:1,updatedAt:'v1'}]];
 if(sql.includes('SELECT * FROM cooperation_relations'))return [relation?[{...relation}]:[]];
 if(sql.startsWith('INSERT INTO cooperation_relations')){relation={id:p[0],customerId:p[1],engineerId:p[2],status:'PENDING'};return [{}];}
 if(sql.startsWith('UPDATE cooperation_relations')){relation.status=p[0];return [{}];}
 if(sql.startsWith('INSERT IGNORE INTO conversations')){if(conv)return [{affectedRows:0}];conv={id:p[0],customerId:p[1],engineerId:p[2],orderId:null,directKey:p[5]};return [{affectedRows:1}];}
 if(sql.startsWith('SELECT * FROM conversations'))return [[conv]];
 if(sql.startsWith('INSERT INTO messages')){if(failMessage)throw Error('message failed');messages.push({senderId:p[1],type:p[2],content:p[3],fileId:p[4]});return [{insertId:messages.length}];}
 if(sql.startsWith('UPDATE conversations'))return [{}];
 throw Error(sql);
}
mock('../src/db',{parseJson:x=>x,queryOne:async()=>null,tx:async fn=>{
 const snapshot=structuredClone({relation,conv,messages,directs});inTx=true;
 try{return await fn({execute});}catch(e){({relation,conv,messages,directs}=snapshot);throw e;}finally{inTx=false;}
}});
mock('../src/services/blacklist-svc',{assertContact:async()=>{}});
const actualChat=require('../src/services/chat-svc');
mock('../src/services/chat-svc',{...actualChat,publishConversationDoc:()=>{assert.equal(inTx,false);},publishSystemMessage:(...args)=>{assert.equal(inTx,false);published.push(args);}});
const svc=require('../src/services/cooperation-svc');
const invite=()=>svc.invite({id:'c',role:'CUSTOMER'},'e',{confirmTerms:true,termsVersion:'v1'});
beforeEach(()=>{relation=null;conv=null;messages=[];published=[];failMessage=false;directs=[];});
test('申请提醒工程师，接受结果提醒客户，复用咨询会话并拒绝重复通知',async()=>{
 await invite();const convId=conv.id;
 assert.equal(messages[0].senderId,'c');assert.equal(messages[0].type,'SYSTEM');assert.equal(messages[0].fileId,'__COOP__');
 await assert.rejects(invite(),e=>e.status===409);assert.equal(messages.length,1);
 await assert.rejects(svc.respond({id:'c'},relation.id,'ACCEPT'),e=>e.status===409);
 await svc.respond({id:'e'},relation.id,'ACCEPT');
 assert.equal(conv.id,convId);assert.equal(messages[1].senderId,'e');assert.match(messages[1].content,/同意/);
 assert.equal(published.length,2);assert.equal(published[1][3].actionCooperation,true);
 await assert.rejects(svc.respond({id:'e'},relation.id,'ACCEPT'),e=>e.status===409);assert.equal(messages.length,2);
});
test('拒绝及再次申请分别提醒，撤销提醒工程师',async()=>{
 await invite();await svc.respond({id:'e'},relation.id,'REJECT');assert.match(messages[1].content,/拒绝/);assert.equal(messages[1].senderId,'e');
 await invite();assert.equal(messages[2].senderId,'c');
 await svc.respond({id:'c'},relation.id,'CANCEL');assert.match(messages[3].content,/撤销/);
});
test('消息写入失败回滚关系状态，不推送；重试后仅一条成功提醒',async()=>{
 failMessage=true;await assert.rejects(invite(),/message failed/);assert.equal(relation,null);assert.equal(published.length,0);
 failMessage=false;await invite();failMessage=true;
 await assert.rejects(svc.respond({id:'e'},relation.id,'ACCEPT'),/message failed/);
 assert.equal(relation.status,'PENDING');assert.equal(messages.length,1);assert.equal(published.length,1);
 failMessage=false;await svc.respond({id:'e'},relation.id,'ACCEPT');assert.equal(messages.length,2);
});
test('定向需求通知指定工程师，复用咨询会话并携带对应订单入口',async()=>{
 relation={id:'r',customerId:'c',engineerId:'e',status:'ACTIVE'};
 const {tx}=require('../src/db');
 const n=await tx(conn=>svc.attachDirect(conn,'c','order1','e',1000,'结构仿真'));
 assert.equal(published.length,0);
 svc.publishDirectNotice(n);
 assert.equal(conv.customerId,'c');assert.equal(conv.engineerId,'e');
 assert.equal(messages[0].senderId,'c');assert.equal(messages[0].fileId,'order1');
 assert.match(messages[0].content,/结构仿真/);assert.equal(n.meta.actionCooperation,undefined);
 assert.equal(published[0][3].actionOrderId,'order1');
 const convId=conv.id;
 await tx(conn=>svc.attachDirect(conn,'c','order2','e',1000));
 assert.equal(conv.id,convId);assert.equal(messages[1].fileId,'order2');
});
test('普通需求不提醒，定向需求失败或后续订单事务回滚不残留消息',async()=>{
 const {tx}=require('../src/db');
 assert.equal(await tx(conn=>svc.attachDirect(conn,'c','public',null,1000)),undefined);
 assert.equal(messages.length,0);
 await assert.rejects(tx(conn=>svc.attachDirect(conn,'c','bad','e',1000)),e=>e.status===409);
 relation={id:'r',customerId:'c',engineerId:'e',status:'ACTIVE'};
 await assert.rejects(tx(async conn=>{await svc.attachDirect(conn,'c','o','e',1000);throw Error('attachment failed');}),/attachment failed/);
 assert.equal(messages.length,0);assert.equal(directs.length,0);assert.equal(published.length,0);
 failMessage=true;await assert.rejects(tx(conn=>svc.attachDirect(conn,'c','o','e',1000)),/message failed/);
 assert.equal(directs.length,0);
});
