'use strict';
const {query,queryOne,tx}=require('../db');
const {newId,v}=require('../lib/util');
const {err}=require('../lib/http');
const BADGES={
 FIRST:{key:'FIRST',title:'初露锋芒',icon:'rocket',rule:'完成首个订单'},
 TEN:{key:'TEN',title:'十单达人',icon:'award',rule:'累计完成10单'},
 WEEK_THREE:{key:'WEEK_THREE',title:'本周先锋',icon:'chart',rule:'一周完成3单'},
 STREAK_THREE:{key:'STREAK_THREE',title:'连续交付',icon:'flame',rule:'连续3天完成订单'}
};
function day(now=new Date()){return new Date(now.getTime()+8*3600000).toISOString().slice(0,10);}
async function checkState(id){
 const today=day();
 const dates=await query("SELECT periodKey FROM incentive_rewards WHERE userId=? AND taskKey='SIGNIN' AND periodKey>=DATE_FORMAT(DATE_SUB(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR),INTERVAL 6 DAY),'%Y-%m-%d')",[id]);
 const calendar=Array.from({length:7},(_,i)=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-6+i);const date=d.toISOString().slice(0,10);return {date,label:date.slice(5),done:dates.some(r=>r.periodKey===date),today:date===today};});
 return {today,checked:dates.some(r=>r.periodKey===today),amount:8,calendar};
}
async function signin(id){
 return tx(async conn=>{
  await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
  const today=day();
  const [[old]]=await conn.execute("SELECT id FROM incentive_rewards WHERE userId=? AND taskKey='SIGNIN' AND periodKey=?",[id,today]);
  if(old)return {duplicate:true,amount:0};
  await conn.execute("INSERT INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,'SIGNIN',?,8,'RESERVED',UTC_TIMESTAMP(3))",[newId(),id,today]);
  return {amount:8,duplicate:false};
 });
}
const OFFERS=[
 {key:'welcome',title:'新人礼包 · 满1000减50',kind:'COUPON',amount:5000,minSpendFen:100000},
 {key:'first',title:'首单任务 · 30元优惠券',kind:'COUPON',amount:3000,minSpendFen:0},
 {key:'starter-coins',title:'仿真币体验礼包',kind:'COINS',amount:20,minSpendFen:0}
];
async function assets(id,offset=0){
 offset=v.int(offset,'offset',{min:0,max:1000000});
 const totals=await queryOne('SELECT COALESCE(SUM(amount),0) total FROM incentive_rewards WHERE userId=?',[id]);
 const coupons=await query(`SELECT id,offerKey,title,amountFen,minSpendFen,expiresAt,CASE WHEN expiresAt<=UTC_TIMESTAMP() THEN 'EXPIRED' ELSE status END status FROM user_coupons WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset}`,[id]);
 const coins=await query(`SELECT id,taskKey,periodKey,amount,status,createdAt FROM incentive_rewards WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset}`,[id]);
 const claimedCoupons=await query('SELECT offerKey FROM user_coupons WHERE userId=?',[id]);
 const claimedCoins=await query("SELECT periodKey FROM incentive_rewards WHERE userId=? AND taskKey='ACTIVITY'",[id]);
 return {balance:Number(totals?.total||0),coupons:coupons.slice(0,20),coins:coins.slice(0,20),nextOffset:Math.max(coupons.length,coins.length)>20?offset+20:null,
 offers:OFFERS.map(o=>({...o,claimed:claimedCoupons.some(x=>x.offerKey===o.key)||claimedCoins.some(x=>x.periodKey===o.key)}))};
}
async function claimOffer(user,key){
 const offer=OFFERS.find(o=>o.key===key);if(!offer)throw err.bad('活动不存在');
 return tx(async conn=>{
  await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
  if(offer.key!=='starter-coins'){
   const [[campaign]]=await conn.execute('SELECT enabled FROM home_campaigns WHERE id=?',[key]);
   if(!campaign||!Number(campaign.enabled))throw err.conflict('活动已下线');
  }
  if(key==='first'){
   const sql=user.role==='CUSTOMER'?"SELECT id FROM orders WHERE customerId=? AND deletedAt IS NULL LIMIT 1":"SELECT o.id FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE q.engineerId=? AND o.status='COMPLETED' AND o.deletedAt IS NULL LIMIT 1";
   const [[eligible]]=await conn.execute(sql,[user.id]);if(!eligible)throw err.conflict(user.role==='CUSTOMER'?'发布首个需求后可领取':'完成首个承接订单后可领取');
  }
  if(offer.kind==='COUPON'){
   const [result]=await conn.execute("INSERT IGNORE INTO user_coupons(id,userId,offerKey,title,amountFen,minSpendFen,status,expiresAt,createdAt) VALUES(?,?,?,?,?,?,'RESERVED',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 90 DAY),UTC_TIMESTAMP(3))",[newId(),user.id,key,offer.title,offer.amount,offer.minSpendFen]);
   return {claimed:true,duplicate:result.affectedRows===0};
  }
  const [result]=await conn.execute("INSERT IGNORE INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,'ACTIVITY',?,?,'RESERVED',UTC_TIMESTAMP(3))",[newId(),user.id,key,offer.amount]);
  return {claimed:true,duplicate:result.affectedRows===0};
 });
}
async function badges(id){
 const rows=await query("SELECT DISTINCT r.taskKey FROM incentive_rewards r JOIN achievement_showcase s ON s.userId=r.userId AND s.taskKey=r.taskKey WHERE r.userId=?",[id]);
 return rows.map(r=>BADGES[r.taskKey]).filter(Boolean);
}
async function showcase(id,key,enabled){
 if(!BADGES[key]||typeof enabled!=='boolean')throw err.bad('无效成就设置');
 return tx(async conn=>{
  await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
  const [[earned]]=await conn.execute('SELECT id FROM incentive_rewards WHERE userId=? AND taskKey=? LIMIT 1',[id,key]);
  if(!earned)throw err.conflict('请先完成任务并领取成就奖励');
  if(enabled)await conn.execute('INSERT IGNORE INTO achievement_showcase(userId,taskKey,createdAt) VALUES(?,?,UTC_TIMESTAMP(3))',[id,key]);
  else await conn.execute('DELETE FROM achievement_showcase WHERE userId=? AND taskKey=?',[id,key]);
  return {enabled};
 });
}
module.exports={day,checkState,signin,assets,claimOffer,badges,showcase,BADGES,OFFERS};

