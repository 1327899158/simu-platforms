'use strict';
const {query,queryOne,tx,parseJson}=require('../db');
const {v,newId}=require('../lib/util');
const {err}=require('../lib/http');
const {assertContact}=require('./blacklist-svc');
const defaults={enabled:0,discountBps:10000,responseHours:24,scheduleNote:'',revisionCount:2,minAmountFen:100};
async function settings(id) {return await queryOne('SELECT * FROM cooperation_settings WHERE engineerId=?',[id])||{...defaults,engineerId:id};}
async function saveSettings(id,b) {
  const values=[b.enabled===true?1:0,v.int(b.discountBps,'折扣(万分比)',{min:1000,max:10000}),v.int(b.responseHours,'响应小时',{min:1,max:720}),v.str(b.scheduleNote,'排期说明',{max:500,optional:true})||'',v.int(b.revisionCount,'修改次数',{min:0,max:20}),v.int(b.minAmountFen,'最低金额(分)',{min:100,max:1000000000})];
  await query('INSERT INTO cooperation_settings(engineerId,enabled,discountBps,responseHours,scheduleNote,revisionCount,minAmountFen,updatedAt) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),discountBps=VALUES(discountBps),responseHours=VALUES(responseHours),scheduleNote=VALUES(scheduleNote),revisionCount=VALUES(revisionCount),minAmountFen=VALUES(minAmountFen),updatedAt=VALUES(updatedAt)',[id,...values]);
  return settings(id);
}
async function invite(user,id,b) {
  if(user.role!=='CUSTOMER'||user.id===id) throw err.forbidden('仅客户可发起合作');
  await assertContact(user.id,id);
  return tx(async conn=>{
    const [[u]]=await conn.execute("SELECT u.id FROM users u JOIN identity_verifications iv ON iv.userId=u.id WHERE u.id=? AND u.role='ENGINEER' AND u.status='ACTIVE' AND u.deletedAt IS NULL AND iv.verifyStatus='APPROVED' FOR UPDATE",[id]);
    if(!u) throw err.notFound('工程师不可用');
    const [[s]]=await conn.execute('SELECT * FROM cooperation_settings WHERE engineerId=? FOR UPDATE',[id]);
    if(!s?.enabled) throw err.conflict('工程师暂未开放合作');
    if(b.confirmTerms!==true||String(b.termsVersion)!==(s.updatedAt instanceof Date?s.updatedAt.toISOString():String(s.updatedAt))) throw err.conflict('请阅读当前合作条件并重新确认');
    const [[old]]=await conn.execute('SELECT * FROM cooperation_relations WHERE customerId=? AND engineerId=? FOR UPDATE',[user.id,id]);
    if(old&&['PENDING','ACTIVE'].includes(old.status)) throw err.conflict('已有合作申请或合作关系');
    const key=old?.id||newId();
    await conn.execute("INSERT INTO cooperation_relations(id,customerId,engineerId,status,terms,message,createdAt,updatedAt) VALUES(?,?,?,'PENDING',?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status='PENDING',terms=VALUES(terms),message=VALUES(message),updatedAt=VALUES(updatedAt)",[key,user.id,id,JSON.stringify(s),v.str(b.message,'合作说明',{max:1000,optional:true})||'']);
    return {id:key};
  });
}
async function respond(user,id,action) {
  v.oneOf(action,'操作',['ACCEPT','REJECT','END','CANCEL']);
  return tx(async conn=>{
    const [[r]]=await conn.execute('SELECT * FROM cooperation_relations WHERE id=? FOR UPDATE',[id]);
    if(!r||![r.customerId,r.engineerId].includes(user.id)) throw err.notFound();
    const allowed=action==='END'?r.status==='ACTIVE':action==='CANCEL'?r.status==='PENDING'&&r.customerId===user.id:r.status==='PENDING'&&r.engineerId===user.id;
    if(!allowed) throw err.conflict('无权执行或状态已变化');
    if(action==='ACCEPT') {
      if(await queryOne("SELECT userId FROM account_closures WHERE userId IN (?,?) AND status='PENDING'",[r.customerId,r.engineerId]))throw err.conflict('对方正在注销账号');
      await assertContact(r.customerId,r.engineerId);
    }
    const status={ACCEPT:'ACTIVE',REJECT:'REJECTED',END:'ENDED',CANCEL:'CANCELLED'}[action];
    await conn.execute('UPDATE cooperation_relations SET status=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?',[status,id]);return {status};
  });
}
async function attachDirect(conn,customerId,orderId,engineerId,budgetFen) {
  if(!engineerId)return;
  if(await queryOne("SELECT userId FROM account_closures WHERE userId=? AND status='PENDING'",[engineerId]))throw err.conflict('工程师正在注销账号');
  v.str(engineerId,'指定工程师',{min:1,max:32});await assertContact(customerId,engineerId);
  const [[r]]=await conn.execute("SELECT r.* FROM cooperation_relations r JOIN users u ON u.id=r.engineerId JOIN identity_verifications iv ON iv.userId=u.id WHERE r.customerId=? AND r.engineerId=? AND r.status='ACTIVE' AND u.status='ACTIVE' AND u.deletedAt IS NULL AND u.role='ENGINEER' AND iv.verifyStatus='APPROVED' FOR UPDATE",[customerId,engineerId]);
  if(!r)throw err.conflict('请先与该工程师建立有效合作关系');
  const terms=parseJson(r.terms);
  if(!budgetFen||budgetFen<Number(terms.minAmountFen)) throw err.bad('定向需求预算不能低于双方确认的最低金额');
  await conn.execute('INSERT INTO direct_demands(orderId,customerId,engineerId,relationId,terms,createdAt) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))',[orderId,customerId,engineerId,r.id,JSON.stringify(terms)]);
}
async function assertScope(orderId,userId) {
  const d=await queryOne('SELECT customerId,engineerId FROM direct_demands WHERE orderId=?',[orderId]);
  if(d&&d.customerId!==userId&&d.engineerId!==userId)throw err.notFound('需求不存在或不可访问');
}
module.exports={settings,saveSettings,invite,respond,attachDirect,assertScope};
