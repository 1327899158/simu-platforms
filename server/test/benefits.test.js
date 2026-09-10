'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let rewards,show,queue,eligible;
async function execute(sql,a){
 if(sql.startsWith('SELECT id FROM users'))return [[{id:a[0]}]];
 if(sql.startsWith('SELECT enabled'))return [[{enabled:1}]];
 if(sql.startsWith('SELECT id FROM orders')||sql.startsWith('SELECT o.id FROM orders'))return [eligible?[{id:'order'}]:[]];
 if(sql.startsWith('SELECT id FROM incentive_rewards')){
  const key=sql.includes("taskKey='SIGNIN'")?'SIGNIN':a[1],period=key==='SIGNIN'?a[1]:null;
  return [[rewards.find(r=>r.userId===a[0]&&r.taskKey===key&&(!period||r.periodKey===period))].filter(Boolean)];
 }
 if(sql.startsWith('INSERT INTO incentive_rewards')||sql.startsWith('INSERT IGNORE INTO incentive_rewards')){
  const isSign=sql.includes("'SIGNIN'"),r={id:a[0],userId:a[1],taskKey:isSign?'SIGNIN':'ACTIVITY',periodKey:a[2],amount:isSign?8:a[3]};
  if(rewards.some(x=>x.userId===r.userId&&x.taskKey===r.taskKey&&x.periodKey===r.periodKey))return [{affectedRows:0}];
  rewards.push(r);return [{affectedRows:1}];
 }
 if(sql.startsWith('INSERT IGNORE INTO achievement_showcase')){show.add(a.join(':'));return [{affectedRows:1}];}
 if(sql.startsWith('DELETE FROM achievement_showcase')){show.delete(a.join(':'));return [{affectedRows:1}];}
 throw Error(sql);
}
mock('../src/db',{query:async()=>[],queryOne:async()=>null,tx(work){const run=queue.then(()=>work({execute}));queue=run.catch(()=>{});return run;}});
const svc=require('../src/services/benefits-svc');
beforeEach(()=>{rewards=[];show=new Set();queue=Promise.resolve();eligible=false;});
test('北京时间签到日界与同一天重复点击，只到账8币',async()=>{
 assert.equal(svc.day(new Date('2026-09-10T15:59:59Z')),'2026-09-10');
 assert.equal(svc.day(new Date('2026-09-10T16:00:00Z')),'2026-09-11');
 const r=await Promise.all([svc.signin('u'),svc.signin('u')]);assert.equal(r.reduce((n,x)=>n+x.amount,0),8);assert.equal(rewards.length,1);
});
test('活动由服务端定义奖励，同一用户重复领取不增发',async()=>{
 await svc.claimOffer({id:'u',role:'CUSTOMER'},'starter-coins');
 const second=await svc.claimOffer({id:'u',role:'CUSTOMER'},'starter-coins');
 assert.equal(second.duplicate,true);assert.equal(rewards[0].amount,20);
 await assert.rejects(svc.claimOffer({id:'u',role:'CUSTOMER'},'arbitrary'),e=>e.status===400);
 await assert.rejects(svc.claimOffer({id:'u',role:'CUSTOMER'},'first'),e=>e.status===409);
});
test('未获成就不能展示，不能展示他人的奖励，已获成就可取消',async()=>{
 await assert.rejects(svc.showcase('u','FIRST',true),e=>e.status===409);
 rewards.push({id:'r',userId:'other',taskKey:'FIRST'});await assert.rejects(svc.showcase('u','FIRST',true),e=>e.status===409);
 rewards.push({id:'own',userId:'u',taskKey:'FIRST'});await svc.showcase('u','FIRST',true);assert.ok(show.has('u:FIRST'));
 await svc.showcase('u','FIRST',false);assert.equal(show.size,0);
 await assert.rejects(svc.showcase('u','SIGNIN',true),e=>e.status===400);
});

