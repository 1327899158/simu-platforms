'use strict';
const {query}=require('../db'),{err}=require('../lib/http'),{v}=require('../lib/util');
function amount(value=0){return v.int(value,'抵扣仿真币',{min:0,max:1000000000});}
async function totals(id,exec=query){
 const [r]=await exec(`SELECT (SELECT COALESCE(SUM(amount),0) FROM incentive_rewards WHERE userId=?) earned,
  (SELECT COALESCE(SUM(coins-refundedCoins),0) FROM coin_spends WHERE userId=? AND status='SPENT') used,
  (SELECT COALESCE(SUM(coins),0) FROM coin_spends WHERE userId=? AND status='HELD') frozen`,[id,id,id]);
 const earned=Number(r?.earned||0),used=Number(r?.used||0),frozen=Number(r?.frozen||0);
 return {earned,used,frozen,balance:Math.max(0,earned-used-frozen),rate:100};
}
async function lock(c,id,active=false){const [[u]]=await c.execute('SELECT id,status,deletedAt FROM users WHERE id=? FOR UPDATE',[id]);if(!u||active&&(u.status!=='ACTIVE'||u.deletedAt))throw err.forbidden('账号不可用');}
async function reserve(c,{userId,key,kind,orderId,coins,gross}){
 coins=amount(coins);if(!coins)return 0;
 if(coins>gross)throw err.bad('仿真币抵扣不能超过应付金额');
 await lock(c,userId,true);
 const [[old]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=? FOR UPDATE',[key]);
 if(old){if(old.userId!==userId||Number(old.coins)!==coins||old.status!=='HELD')throw err.conflict('抵扣记录不一致');return coins;}
 // 用当前读，避免事务在等待用户锁之前创建的快照漏掉另一笔冻结。
 const [rewards]=await c.execute('SELECT amount FROM incentive_rewards WHERE userId=? FOR UPDATE',[userId]);
 const [spends]=await c.execute("SELECT coins,refundedCoins,status FROM coin_spends WHERE userId=? AND status IN ('HELD','SPENT') FOR UPDATE",[userId]);
 const balance=rewards.reduce((sum,r)=>sum+Number(r.amount),0)-spends.reduce((sum,s)=>sum+Number(s.coins)-(s.status==='SPENT'?Number(s.refundedCoins):0),0);
 if(coins>balance)throw err.conflict('可用仿真币不足，请刷新后重试');
 await c.execute("INSERT INTO coin_spends(businessKey,userId,kind,orderId,coins,status,createdAt,updatedAt) VALUES(?,?,?,?,?,'HELD',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[key,userId,kind,orderId,coins]);
 return coins;
}
async function commit(c,key,coins){
 if(!Number(coins))return;
 const [[s]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=?',[key]);
 if(!s)throw err.conflict('仿真币冻结记录不存在');
 await lock(c,s.userId);
 const [r]=await c.execute("UPDATE coin_spends SET status='SPENT',updatedAt=UTC_TIMESTAMP(3) WHERE businessKey=? AND coins=? AND status='HELD'",[key,coins]);
 if(r.affectedRows!==1)throw err.conflict('仿真币冻结已失效，请联系客服核查支付');
}
async function release(c,key){
 const [[s]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=?',[key]);if(!s||s.status!=='HELD')return;
 await lock(c,s.userId);await c.execute("UPDATE coin_spends SET status='RELEASED',updatedAt=UTC_TIMESTAMP(3) WHERE businessKey=? AND status='HELD'",[key]);
}
async function refund(c,orderId,businessKey,grossRefund=null){
 const [spends]=await c.execute("SELECT s.*,COALESCE(p.grossAmountFen,p.amountFen) gross FROM coin_spends s JOIN payments p ON CONCAT('ORDER:',p.outTradeNo) COLLATE utf8mb4_unicode_ci=s.businessKey WHERE s.orderId=? AND s.kind='ORDER' AND s.status='SPENT'",[orderId]);
 for(const s of spends){
  await lock(c,s.userId);
  const [[current]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=? FOR UPDATE',[s.businessKey]);
  const refundKey=businessKey+':'+s.businessKey;
  const [[old]]=await c.execute('SELECT businessKey FROM coin_refunds WHERE businessKey=? FOR UPDATE',[refundKey]);if(old)continue;
  const remaining=Number(current.coins)-Number(current.refundedCoins),n=Math.min(remaining,grossRefund==null?remaining:Math.floor(Number(current.coins)*Math.min(Number(grossRefund),Number(s.gross))/Number(s.gross)));
  if(n<=0)continue;
  await c.execute('INSERT INTO coin_refunds(businessKey,paymentKey,userId,coins,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',[refundKey,s.businessKey,s.userId,n]);
  await c.execute('UPDATE coin_spends SET refundedCoins=refundedCoins+?,updatedAt=UTC_TIMESTAMP(3) WHERE businessKey=?',[n,s.businessKey]);
 }
}
// 真实退款按已冻结的退款计划返币，保证分次退款的尾差和现金账一致。
async function refundExact(c,paymentKey,businessKey,coins){
 coins=amount(coins);if(!coins)return;
 const [[lookup]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=?',[paymentKey]);
 if(!lookup)throw err.conflict('退款抵扣记录不存在');
 await lock(c,lookup.userId);
 const [[s]]=await c.execute('SELECT * FROM coin_spends WHERE businessKey=? FOR UPDATE',[paymentKey]);
 const key=businessKey+':'+paymentKey;
 const [[old]]=await c.execute('SELECT * FROM coin_refunds WHERE businessKey=? FOR UPDATE',[key]);
 if(old){if(Number(old.coins)!==coins)throw err.conflict('返币金额不一致');return;}
 if(s.status!=='SPENT'||Number(s.coins)-Number(s.refundedCoins)<coins)throw err.conflict('可退仿真币不足');
 await c.execute('INSERT INTO coin_refunds(businessKey,paymentKey,userId,coins,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',[key,paymentKey,s.userId,coins]);
 await c.execute('UPDATE coin_spends SET refundedCoins=refundedCoins+?,updatedAt=UTC_TIMESTAMP(3) WHERE businessKey=?',[coins,paymentKey]);
}
module.exports={amount,totals,reserve,commit,release,refund,refundExact};
