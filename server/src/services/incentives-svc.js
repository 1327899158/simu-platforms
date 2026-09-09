'use strict';
const {query,tx}=require('../db');
const {newId,v}=require('../lib/util');
const {err}=require('../lib/http');
function week(now=new Date()) {
  const day=new Date(now.getTime()+8*3600000);day.setUTCHours(0,0,0,0);
  day.setUTCDate(day.getUTCDate()-((day.getUTCDay()+6)%7));return day.toISOString().slice(0,10);
}
function metrics(rows,start,today=new Date(Date.now()+8*3600000).toISOString().slice(0,10)) {
  const dates=new Set(rows.map(x=>String(x.day)));
  let streak=0,d=new Date(today+'T00:00:00Z');
  if(!dates.has(today))d.setUTCDate(d.getUTCDate()-1);
  while(dates.has(d.toISOString().slice(0,10))){streak++;d.setUTCDate(d.getUTCDate()-1);}
  return {total:rows.length,weekly:rows.filter(x=>String(x.day)>=start).length,streak};
}
async function state(id,exec=query) {
  const period=week();
  const rows=await exec("SELECT o.id,DATE_FORMAT(DATE_ADD(o.completedAt,INTERVAL 8 HOUR),'%Y-%m-%d') day FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE q.engineerId=? AND o.status='COMPLETED' AND o.deletedAt IS NULL AND o.completedAt IS NOT NULL AND o.completedAt<=UTC_TIMESTAMP(3)",[id]);
  const m=metrics(rows,period);
  const rewards=await exec('SELECT taskKey,periodKey,amount,status,createdAt FROM incentive_rewards WHERE userId=? ORDER BY createdAt DESC',[id]);
  const tasks=[{key:'FIRST',title:'完成首单',value:m.total,target:1,amount:50,period:'LIFETIME'},
    {key:'TEN',title:'累计完成10单',value:m.total,target:10,amount:100,period:'LIFETIME'},
    {key:'WEEK_THREE',title:'本周完成3单',value:m.weekly,target:3,amount:100,period},
    {key:'STREAK_THREE',title:'连续3天完成订单',value:m.weekly?m.streak:0,target:3,amount:80,period}]
    .map(t=>({...t,eligible:t.value>=t.target,claimed:rewards.some(r=>r.taskKey===t.key&&r.periodKey===t.period)}));
  return {period,...m,tasks,rewards:rewards.slice(0,50),reservedCoins:rewards.reduce((n,r)=>n+Number(r.amount),0)};
}
async function claim(id,key) {
  v.oneOf(key,'任务',['FIRST','TEN','WEEK_THREE','STREAK_THREE']);
  return tx(async conn=>{
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
    const s=await state(id,(sql,p)=>conn.execute(sql,p).then(([r])=>r));const t=s.tasks.find(x=>x.key===key);
    if(t.claimed)return {claimed:true,duplicate:true};if(!t.eligible)throw err.conflict('尚未满足任务条件');
    await conn.execute("INSERT INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,?,?,?,'RESERVED',UTC_TIMESTAMP(3))",[newId(),id,t.key,t.period,t.amount]);
    return {claimed:true,amount:t.amount,status:'RESERVED'};
  });
}
async function leaderboard() {
  return query("SELECT u.id,u.nickname,u.avatarUrl,COUNT(*) completed FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId JOIN users u ON u.id=q.engineerId WHERE o.status='COMPLETED' AND o.deletedAt IS NULL AND u.status='ACTIVE' AND u.deletedAt IS NULL AND u.role='ENGINEER' AND o.completedAt<=UTC_TIMESTAMP(3) AND DATE_ADD(o.completedAt,INTERVAL 8 HOUR)>=? GROUP BY u.id,u.nickname,u.avatarUrl ORDER BY completed DESC,u.id LIMIT 20",[week()+' 00:00:00']);
}
module.exports={state,claim,leaderboard,week,metrics};
