'use strict';
const {query,queryOne,tx}=require('../db');
const {newId}=require('../lib/util');
const {err}=require('../lib/http');
// 只去标识化账号档案；交易、票据、举证及审计继续保留，不进行破坏性级联删除。
async function blockers(exec,id) {
  const checks=[
    ['未完成需求或订单',`SELECT COUNT(*) n FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE (o.customerId=? OR q.engineerId=?) AND o.deletedAt IS NULL AND o.status NOT IN ('COMPLETED','CANCELLED','CLOSED')`,[id,id]],
    ['待处理退款申请',`SELECT COUNT(*) n FROM refund_requests WHERE (customerId=? OR engineerId=?) AND status IN ('PENDING','AGREED')`,[id,id]],
    ['待确认支付',`SELECT COUNT(*) n FROM payments p JOIN orders o ON o.id=p.orderId LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE (o.customerId=? OR q.engineerId=?) AND p.status='PENDING'`,[id,id]],
    ['有效报价',`SELECT COUNT(*) n FROM quotes q JOIN orders o ON o.id=q.orderId WHERE q.engineerId=? AND q.status='PENDING' AND o.status='QUOTING' AND o.deletedAt IS NULL`,[id]],
    ['未结束纠纷或退款登记',`SELECT COUNT(*) n FROM disputes d JOIN orders o ON o.id=d.orderId LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE (o.customerId=? OR q.engineerId=?) AND (d.status='OPEN' OR d.refundStatus IN ('PENDING','FAILED'))`,[id,id]],
    ['待处理发票',`SELECT COUNT(*) n FROM invoice_requests WHERE (customerId=? OR engineerId=?) AND status NOT IN ('ISSUED','REJECTED')`,[id,id]],
    ['未处理举报或反馈',`SELECT COUNT(*) n FROM support_submissions WHERE (userId=? OR targetId=?) AND status NOT IN ('RESOLVED','REJECTED')`,[id,id]],
    ['有效合作或待处理合作申请',`SELECT COUNT(*) n FROM cooperation_relations WHERE (customerId=? OR engineerId=?) AND status IN ('PENDING','ACTIVE')`,[id,id]],
    ['管理员身份',`SELECT COUNT(*) n FROM admin_accounts WHERE userId=? AND status='ACTIVE'`,[id]],
  ];
  const result=[];for(const [label,sql,args] of checks){const rows=await exec(sql,args);if(Number(rows[0]?.n))result.push({label,count:Number(rows[0].n)});}return result;
}
async function status(id) {return {request:await queryOne('SELECT * FROM account_closures WHERE userId=?',[id]),blockers:await blockers(query,id),coolingDays:15};}
async function apply(id,confirmed) {
  if(confirmed!==true)throw err.bad('请确认注销须知');
  return tx(async conn=>{
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
    const list=await blockers((s,p)=>conn.execute(s,p).then(([r])=>r),id);
    if(list.length)throw err.conflict('暂不能注销：'+list.map(x=>x.label).join('、'));
    const [[old]]=await conn.execute('SELECT status FROM account_closures WHERE userId=? FOR UPDATE',[id]);
    if(old?.status==='PENDING')throw err.conflict('已在注销冷静期内');
    await conn.execute("INSERT INTO account_closures(userId,status,requestedAt,executeAfter,updatedAt) VALUES(?,'PENDING',UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 DAY),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE status='PENDING',requestedAt=UTC_TIMESTAMP(3),executeAfter=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 DAY),completedAt=NULL,lastError=NULL,updatedAt=UTC_TIMESTAMP(3)",[id]);
    await conn.execute("INSERT INTO account_closure_events(id,userId,action,createdAt) VALUES(?,?,'REQUESTED',UTC_TIMESTAMP(3))",[newId(),id]);return {requested:true};
  });
}
async function cancel(id) {
  return tx(async conn=>{
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
    const [r]=await conn.execute("UPDATE account_closures SET status='CANCELLED',updatedAt=UTC_TIMESTAMP(3) WHERE userId=? AND status='PENDING'",[id]);
    if(!r.affectedRows)throw err.conflict('没有可撤销的注销申请');
    await conn.execute("INSERT INTO account_closure_events(id,userId,action,createdAt) VALUES(?,?,'CANCELLED',UTC_TIMESTAMP(3))",[newId(),id]);return {cancelled:true};
  });
}
async function guard(req,user) {
  // 冷静期允许查阅、退出及撤销；暂停新增业务，防止一边注销一边接单。
  if(!req.method||req.method==='GET'||/^\/api\/(account-closure\/cancel|auth\/(?:logout|wx-login))(?:\?|$)/.test(req.url||''))return user;
  const r=await queryOne("SELECT userId FROM account_closures WHERE userId=? AND status='PENDING'",[user.id]);
  if(r)throw err.conflict('账号处于注销冷静期，请先在“我的→注销账号”撤销申请');return user;
}
async function sweep() {
  const due=await query("SELECT userId FROM account_closures WHERE status='PENDING' AND executeAfter<=UTC_TIMESTAMP(3) ORDER BY executeAfter LIMIT 50");
  for(const item of due)await tx(async conn=>{
    const exec=(s,p)=>conn.execute(s,p).then(([r])=>r);
    const [[user]]=await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[item.userId]);if(!user)return;
    const [[r]]=await conn.execute("SELECT * FROM account_closures WHERE userId=? AND status='PENDING' AND executeAfter<=UTC_TIMESTAMP(3) FOR UPDATE",[user.id]);if(!r)return;
    const list=await blockers(exec,user.id);
    if(list.length){await exec('UPDATE account_closures SET lastError=?,updatedAt=UTC_TIMESTAMP(3) WHERE userId=?',[list.map(x=>x.label).join('、'),user.id]);return;}
    await exec("UPDATE users SET status='DELETED',deletedAt=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3),nickname='已注销用户',avatarUrl=NULL,phone=NULL,username=NULL,passwordHash=NULL,openid=NULL,unionid=NULL,sessionToken=NULL,sessionExpiresAt=NULL WHERE id=?",[user.id]);
    await exec("UPDATE engineer_profiles SET realName=NULL,intro=NULL,specialties=JSON_ARRAY(),softwares=JSON_ARRAY(),verifyStatus='REJECTED' WHERE userId=?",[user.id]);
    await exec("UPDATE identity_verifications SET realName=NULL,phone=NULL,idCardCipher=NULL,idCardHash=NULL,verifyStatus='REJECTED' WHERE userId=?",[user.id]);
    await exec('DELETE FROM engineer_cases WHERE engineerId=?',[user.id]);
    await exec('DELETE FROM user_favorites WHERE userId=?',[user.id]);
    await exec('DELETE FROM user_blocks WHERE ownerId=? OR blockedUserId=?',[user.id,user.id]);
    await exec('UPDATE cooperation_settings SET enabled=0 WHERE engineerId=?',[user.id]);
    await exec("UPDATE account_closures SET status='COMPLETED',completedAt=UTC_TIMESTAMP(3),lastError=NULL,updatedAt=UTC_TIMESTAMP(3) WHERE userId=?",[user.id]);
    await exec("INSERT INTO account_closure_events(id,userId,action,createdAt) VALUES(?,?,'COMPLETED',UTC_TIMESTAMP(3))",[newId(),user.id]);
  });
}
function start() {
  let running=false;const run=async()=>{if(running)return;running=true;try{await sweep();}catch(e){console.error('[account-closure]',e.message);}finally{running=false;}};
  run();const timer=setInterval(run,60000);timer.unref();return timer;
}
module.exports={status,apply,cancel,guard,blockers,sweep,start};
