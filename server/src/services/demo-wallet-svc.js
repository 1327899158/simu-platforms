'use strict';
const {query,queryOne,tx}=require('../db');
const {v,newId}=require('../lib/util');
const {err}=require('../lib/http');
const {writeAdminAudit}=require('../lib/admin-mw');
const AMOUNT_MAX=100000000;
function amount(x){return v.int(x,'模拟金额（分）',{min:100,max:AMOUNT_MAX});}
function key(x){return v.str(x,'业务编号',{min:8,max:64});}
async function lock(conn,id){
 const [[u]]=await conn.execute('SELECT id,role,status FROM users WHERE id=? FOR UPDATE',[id]);
 if(!u||u.role!=='ENGINEER'||u.status!=='ACTIVE')throw err.forbidden('工程师账号不可用');
 const [[closing]]=await conn.execute("SELECT userId FROM account_closures WHERE userId=? AND status='PENDING'",[id]);
 if(closing)throw err.conflict('账号处于注销冷静期');
 await conn.execute('INSERT IGNORE INTO demo_wallets(userId,updatedAt) VALUES(?,UTC_TIMESTAMP(3))',[id]);
 const [[w]]=await conn.execute('SELECT * FROM demo_wallets WHERE userId=? FOR UPDATE',[id]);
 return w;
}
async function entry(conn,w,businessKey,kind,da,df,note){
 const available=Number(w.availableFen)+da,frozen=Number(w.frozenFen)+df;
 if(!Number.isSafeInteger(available)||!Number.isSafeInteger(frozen))throw err.conflict('余额超出安全计数范围');
 if(available<0||frozen<0)throw err.conflict('余额不足或冻结金额不一致');
 await conn.execute('UPDATE demo_wallets SET availableFen=?,frozenFen=?,updatedAt=UTC_TIMESTAMP(3) WHERE userId=?',[available,frozen,w.userId]);
 await conn.execute('INSERT INTO demo_wallet_ledger(id,userId,businessKey,kind,deltaAvailable,deltaFrozen,availableAfter,frozenAfter,note,createdAt) VALUES(?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[newId(),w.userId,businessKey,kind,da,df,available,frozen,note]);
}
async function snapshot(id,offset=0){
 offset=v.int(offset,'offset',{min:0,max:1000000});
 const w=await queryOne('SELECT availableFen,frozenFen FROM demo_wallets WHERE userId=?',[id]);
 const cards=await query("SELECT id,bankName,lastFour FROM demo_bank_cards WHERE userId=? AND status='ACTIVE' ORDER BY createdAt DESC",[id]);
 const ledger=await query(`SELECT * FROM demo_wallet_ledger WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset}`,[id]);
 const withdrawals=await query(`SELECT * FROM demo_withdrawals WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset}`,[id]);
 const holds=await query(`SELECT * FROM demo_wallet_holds WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset}`,[id]);
 return {mode:'SIMULATED',availableFen:Number(w?.availableFen||0),frozenFen:Number(w?.frozenFen||0),cards,ledger:ledger.slice(0,20),withdrawals:withdrawals.slice(0,20),holds:holds.slice(0,20),nextOffset:[ledger,withdrawals,holds].some(x=>x.length>20)?offset+20:null};
}
async function card(id,b){
 if(b.cardNumber||b.phone||b.realName)throw err.bad('演示模式请勿提交真实卡号、姓名或手机号');
 const bank=v.str(b.bankName,'银行名称',{min:2,max:50}),last=v.str(b.lastFour,'测试尾号',{min:4,max:4});
 if(!/^\d{4}$/.test(last))throw err.bad('请输入4位测试尾号');
 return tx(async conn=>{
  await lock(conn,id);
  const [[pending]]=await conn.execute("SELECT id FROM demo_withdrawals WHERE userId=? AND status IN ('SUBMITTED','APPROVED','PAYING') LIMIT 1",[id]);
  if(pending)throw err.conflict('有处理中模拟提现，暂不能换绑');
  await conn.execute("UPDATE demo_bank_cards SET status='REMOVED' WHERE userId=?",[id]);
  const cardId=newId();
  await conn.execute("INSERT INTO demo_bank_cards(id,userId,bankName,lastFour,status,createdAt) VALUES(?,?,?,?,'ACTIVE',UTC_TIMESTAMP(3))",[cardId,id,bank,last]);
  return {id:cardId,bankName:bank,lastFour:last,mode:'SIMULATED'};
 });
}
async function unbind(id){
 return tx(async conn=>{
  await lock(conn,id);
  const [[pending]]=await conn.execute("SELECT id FROM demo_withdrawals WHERE userId=? AND status IN ('SUBMITTED','APPROVED','PAYING') LIMIT 1",[id]);
  if(pending)throw err.conflict('有处理中模拟提现，暂不能解绑');
  await conn.execute("UPDATE demo_bank_cards SET status='REMOVED' WHERE userId=?",[id]);return {removed:true};
 });
}
async function withdraw(id,b){
 const fen=amount(b.amountFen),businessKey=key(b.businessKey),cardId=v.str(b.cardId,'收款卡',{min:1,max:32});
 return tx(async conn=>{
  const w=await lock(conn,id);
  const [[old]]=await conn.execute('SELECT * FROM demo_withdrawals WHERE userId=? AND businessKey=?',[id,businessKey]);
  if(old){if(Number(old.amountFen)!==fen||old.cardId!==cardId)throw err.conflict('业务编号已用于其他申请');return {id:old.id,duplicate:true};}
  const [[c]]=await conn.execute("SELECT * FROM demo_bank_cards WHERE id=? AND userId=? AND status='ACTIVE'",[cardId,id]);
  if(!c)throw err.bad('请先绑定模拟银行卡');
  const wid=newId();
  await entry(conn,w,'WITHDRAW:'+wid,'FREEZE',-fen,fen,'模拟提现申请冻结');
  await conn.execute("INSERT INTO demo_withdrawals(id,userId,businessKey,cardId,bankLabel,amountFen,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,'SUBMITTED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[wid,id,businessKey,cardId,c.bankName+' 尾号'+c.lastFour,fen]);
  await conn.execute("INSERT INTO demo_wallet_holds(id,userId,withdrawalId,amountFen,status,createdAt,updatedAt) VALUES(?,?,?,?,'HELD',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[newId(),id,wid,fen]);
  await event(conn,wid,'SUBMITTED','模拟申请，未触发真实打款',id);
  return {id:wid,mode:'SIMULATED'};
 });
}
async function event(conn,id,status,note,actor){
 await conn.execute('INSERT INTO demo_withdrawal_events(id,withdrawalId,status,note,actorId,createdAt) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))',[newId(),id,status,note,actor]);
}
const transitions={SUBMITTED:['APPROVED','REJECTED','CANCELLED'],APPROVED:['PAYING','REJECTED'],PAYING:['PAID_SIMULATED','FAILED']};
async function transition(id,to,note,userId,req,admin){
 v.oneOf(to,'处理状态',['APPROVED','REJECTED','CANCELLED','PAYING','PAID_SIMULATED','FAILED']);
 note=v.str(note||'模拟流程处理','处理说明',{min:2,max:300});
 const row=await queryOne('SELECT userId FROM demo_withdrawals WHERE id=?',[id]);
 if(!row||(!admin&&row.userId!==userId))throw err.notFound();
 if(!admin&&to!=='CANCELLED')throw err.forbidden();
 return tx(async conn=>{
  const w=await lock(conn,row.userId);
  const [[r]]=await conn.execute('SELECT * FROM demo_withdrawals WHERE id=? FOR UPDATE',[id]);
  if(r.status===to)return {status:to,duplicate:true};
  if(!transitions[r.status]?.includes(to))throw err.conflict('状态已变化，请刷新后重试');
  const release=['REJECTED','CANCELLED','FAILED'].includes(to),paid=to==='PAID_SIMULATED',fen=Number(r.amountFen);
  if(release||paid){
   await entry(conn,w,'END:'+id,release?'RELEASE':'PAYOUT_SIMULATED',release?fen:0,-fen,note);
   await conn.execute('UPDATE demo_wallet_holds SET status=?,updatedAt=UTC_TIMESTAMP(3) WHERE withdrawalId=?',[release?'RELEASED':'CONSUMED',id]);
  }
  await conn.execute('UPDATE demo_withdrawals SET status=?,note=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?',[to,note,id]);
  await event(conn,id,to,note,admin?.id||userId);
  if(admin)await writeAdminAudit(req,admin,'DEMO_WITHDRAW_'+to,'DEMO_WITHDRAWAL',id,{note},conn);
  return {status:to,mode:'SIMULATED'};
 });
}
async function credit(req,admin,b){
 const id=v.str(b.userId,'工程师ID',{min:1,max:32}),fen=amount(b.amountFen),businessKey=key(b.businessKey),note=v.str(b.note,'入账说明',{min:2,max:300});
 return tx(async conn=>{
  const w=await lock(conn,id);
  const [[old]]=await conn.execute('SELECT deltaAvailable FROM demo_wallet_ledger WHERE userId=? AND businessKey=?',[id,'CREDIT:'+businessKey]);
  if(old){if(Number(old.deltaAvailable)!==fen)throw err.conflict('业务编号金额不一致');return {duplicate:true};}
  await entry(conn,w,'CREDIT:'+businessKey,'CREDIT_SIMULATED',fen,0,note);
  await writeAdminAudit(req,admin,'DEMO_WALLET_CREDIT','USER',id,{amountFen:fen,businessKey,note},conn);
  return {credited:true,mode:'SIMULATED'};
 });
}
module.exports={snapshot,card,unbind,withdraw,transition,credit,transitions,amount,entry};
