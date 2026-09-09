'use strict';
const {test,beforeEach}=require('node:test');const assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let sqls,one,run,execute;
mock('../src/db',{query:async(s,p=[])=>{sqls.push([s,p]);return run(s,p);},queryOne:async(s,p=[])=>{sqls.push([s,p]);return one(s,p);},tx:async fn=>fn({execute:async(s,p=[])=>{sqls.push([s,p]);return [await execute(s,p)];}}),parseJson:x=>typeof x==='string'?JSON.parse(x):x});
mock('../src/config',{config:{identityDataKey:'test-key-only',cloudbaseEnv:'test'}});
let audits;mock('../src/lib/admin-mw',{writeAdminAudit:async(...args)=>audits.push(args)});
mock('../src/services/blacklist-svc',{assertContact:async()=>{}});
const fav=require('../src/services/favorites-svc'),sup=require('../src/services/support-svc'),coop=require('../src/services/cooperation-svc'),close=require('../src/services/account-closure-svc'),inc=require('../src/services/incentives-svc'),evidence=require('../src/services/support-evidence-svc');
beforeEach(()=>{sqls=[];audits=[];one=async()=>null;run=async()=>[];execute=async()=>[];});
test('收藏：新增限制为有效公开内容，重复新增使用唯一键',async()=>{
  await assert.rejects(fav.add('u','OTHER','x'),e=>e.status===400);
  await assert.rejects(fav.add('u','ENGINEER','x'),e=>e.status===404);
  one=async()=>({id:'e'});await fav.add('u','ENGINEER','e');assert.match(sqls.at(-1)[0],/INSERT IGNORE/);
  assert.match(fav.source('CASE').where,/COMPLETED/);assert.match(fav.source('CASE').where,/APPROVED/);assert.match(fav.source('DEMAND').where,/NOT EXISTS.*direct_demands/);
});
test('收藏：分页只计可见内容，批量删除限定本人和分类',async()=>{
  run=async()=>Array.from({length:21},(_,i)=>({id:String(i)}));const p=await fav.list('u','CASE',20);assert.equal(p.items.length,20);assert.equal(p.nextOffset,40);
  assert.match(sqls[0][0],/JOIN user_favorites f ON f.targetId=t.id/);assert.deepEqual(sqls[0][1],['u','CASE']);
  await assert.rejects(fav.list('u','CASE','0;DELETE'),e=>e.status===400);
  await fav.remove('u','DEMAND',['a','b']);assert.match(sqls.at(-1)[0],/WHERE userId=\? AND kind=\?/);assert.deepEqual(sqls.at(-1)[1],['u','DEMAND','a','b']);
});
test('举报：不可举报自己或不存在的用户，证据必须本人所有',async()=>{
  const b={kind:'REPORT',targetId:'u',category:'其他',content:'这是一条足够长的举报说明内容'};
  await assert.rejects(sup.create({id:'u'},b),e=>e.status===400);
  await assert.rejects(sup.create({id:'u'},{...b,targetId:'e'}),e=>e.status===404);
  await assert.rejects(sup.evidenceFor('u',[{id:'f',name:'图'}]),e=>e.status===403);
  one=async()=>({id:'f'});assert.equal((await sup.evidenceFor('u',[{id:'f',name:'图'}]))[0].id,'f');
  await assert.rejects(sup.evidenceFor('u',[{id:'f',name:'图'},{id:'f',name:'图'}]),e=>e.status===400);
});
test('反馈：创建记录及时间线，不自动处罚用户',async()=>{
  execute=async s=>s.includes('COUNT(*)')?[{n:0}]:[];
  await sup.create({id:'u'},{kind:'FEEDBACK',content:'希望可以进一步完善这项功能的体验',evidence:[]});
  assert(sqls.some(([s])=>s.includes('INSERT INTO support_submissions')));assert(sqls.some(([s])=>s.includes('INSERT INTO support_events')));assert(!sqls.some(([s])=>s.includes('UPDATE users')));
});
test('举报处理：合法流转、结果与审计同一事务；拒绝跳过受理和重复结案',async()=>{
  execute=async s=>s.startsWith('SELECT * FROM support_submissions')?[{id:'s',status:'SUBMITTED',kind:'REPORT'}]:[];
  await assert.rejects(sup.process({}, {id:'a'},'s',{status:'RESOLVED',note:'直接完成'}),e=>e.status===409);
  await sup.process({}, {id:'a'},'s',{status:'ACCEPTED',note:'已受理核实'});assert.equal(audits.length,1);assert.equal(audits[0][2],'SUPPORT_PROCESS');assert(audits[0].at(-1).execute);
  execute=async()=>[{id:'s',status:'RESOLVED'}];await assert.rejects(sup.process({}, {id:'a'},'s',{status:'ACCEPTED',note:'重新受理'}),e=>e.status===409);
});
test('反馈详情：不向其他用户或被举报人开放',async()=>{
  await assert.rejects(sup.detail('s','other'),e=>e.status===404);assert.deepEqual(sqls[0][1],['s','other']);
});
test('证据：加密保存、授权读取、非图片拒绝',async()=>{
  one=async()=>({n:0});let saved;
  run=async(s,p)=>{saved={id:p[0],userId:p[1],mime:p[2],payload:p[3]};return {};};
  const image=Buffer.from([255,216,255,0,1,2,3]).toString('base64');const f=await evidence.upload('u',{base64:image});
  assert.notEqual(saved.payload,image);one=async()=>saved;
  assert.equal((await evidence.read(f.id,'u')).base64,image);await assert.rejects(evidence.read(f.id,'other'),e=>e.status===404);
  assert.equal((await evidence.read(f.id,null,true)).mime,'image/jpeg');
  await assert.rejects(evidence.upload('u',{base64:Buffer.from('not a picture').toString('base64')}),e=>e.status===400);
});
test('合作设置：限制折扣、响应时限、修改次数与最低金额',async()=>{
  const b={enabled:true,discountBps:9500,responseHours:24,scheduleNote:'提前三天排期',revisionCount:2,minAmountFen:10000};
  for(const bad of [{discountBps:0},{discountBps:10001},{responseHours:0},{revisionCount:-1},{minAmountFen:0}])await assert.rejects(coop.saveSettings('e',{...b,...bad}),e=>e.status===400);
  await coop.saveSettings('e',b);assert.deepEqual(sqls.find(([s])=>s.startsWith('INSERT INTO cooperation_settings'))[1],['e',1,9500,24,'提前三天排期',2,10000]);
});
test('合作意向：必须确认当前条款版本，保存快照而非引用动态设置',async()=>{
  const date=new Date('2026-09-09T00:00:00Z');
  execute=async s=>s.includes('SELECT u.id')?[{id:'e'}]:s.includes('FROM cooperation_settings')?[{engineerId:'e',enabled:1,discountBps:9500,updatedAt:date}]:[];
  await assert.rejects(coop.invite({id:'c',role:'CUSTOMER'},'e',{confirmTerms:false}),e=>e.status===409);
  await assert.rejects(coop.invite({id:'c',role:'CUSTOMER'},'e',{confirmTerms:true,termsVersion:'old'}),e=>e.status===409);
  await coop.invite({id:'c',role:'CUSTOMER'},'e',{confirmTerms:true,termsVersion:date.toISOString()});
  const saved=sqls.find(([s])=>s.startsWith('INSERT INTO cooperation_relations'));assert.equal(JSON.parse(saved[1][3]).discountBps,9500);
});
test('合作确认：客户不能替工程师接受；结束不删除已有定向订单',async()=>{
  let status='PENDING';execute=async s=>s.startsWith('SELECT * FROM cooperation_relations')?[{id:'r',customerId:'c',engineerId:'e',status}]:[];
  await assert.rejects(coop.respond({id:'c'},'r','ACCEPT'),e=>e.status===409);
  assert.equal((await coop.respond({id:'e'},'r','ACCEPT')).status,'ACTIVE');status='ACTIVE';
  assert.equal((await coop.respond({id:'c'},'r','END')).status,'ENDED');assert(!sqls.some(([s])=>/DELETE.*orders/.test(s)));
});
test('定向需求：只有有效合作能创建，预算门槛和条款快照生效',async()=>{
  const calls=[],conn={execute:async(s,p)=>{calls.push([s,p]);return [s.startsWith('SELECT')?[{id:'r',terms:JSON.stringify({minAmountFen:10000,discountBps:9500})}]:{}];}};
  await assert.rejects(coop.attachDirect(conn,'c','o','e',9999),e=>e.status===400);
  await coop.attachDirect(conn,'c','o','e',10000);assert(calls.some(([s])=>s.startsWith('INSERT INTO direct_demands')));
  assert(!calls.some(([s])=>/UPDATE payments|UPDATE orders/.test(s)));
});
test('定向权限：客户与指定工程师可读，第三人不得通过ID绕过',async()=>{
  one=async()=>({customerId:'c',engineerId:'e'});await coop.assertScope('o','c');await coop.assertScope('o','e');await assert.rejects(coop.assertScope('o','x'),e=>e.status===404);
  one=async()=>null;await coop.assertScope('public','x');
});
test('激励：北京时间周一边界、真实完成日期与连续天数',()=>{
  assert.equal(inc.week(new Date('2026-09-06T16:00:00Z')),'2026-09-07');assert.equal(inc.week(new Date('2026-09-06T15:59:59Z')),'2026-08-31');
  const m=inc.metrics([{day:'2026-09-07'},{day:'2026-09-08'},{day:'2026-09-08'},{day:'2026-09-09'}],'2026-09-07','2026-09-09');assert.deepEqual(m,{total:4,weekly:4,streak:3});
  assert.equal(inc.metrics([{day:'2026-09-07'}],'2026-09-07','2026-09-09').streak,0);
});
test('激励：不信任客户端，未完成不可领，重复领取不重复发放',async()=>{
  let completed=false,claimed=false,inserts=0;
  execute=async(s)=>{if(s.includes('SELECT o.id'))return completed?[{id:'o',day:'2026-09-09'}]:[];if(s.includes('FROM incentive_rewards'))return claimed?[{taskKey:'FIRST',periodKey:'LIFETIME',amount:50}]:[];if(s.startsWith('INSERT INTO incentive_rewards')){inserts++;claimed=true;}return [];};
  await assert.rejects(inc.claim('e','FIRST'),e=>e.status===409);completed=true;await inc.claim('e','FIRST');assert.equal((await inc.claim('e','FIRST')).duplicate,true);assert.equal(inserts,1);
});
test('注销：未完成事项阻止申请，未确认不可申请',async()=>{
  await assert.rejects(close.apply('u',false),e=>e.status===400);
  execute=async s=>s.includes('COUNT(*)')?[{n:1}]:[];
  await assert.rejects(close.apply('u',true),e=>e.status===409);assert(!sqls.some(([s])=>s.startsWith('INSERT INTO account_closures')));
});
test('注销：15天延迟、可撤销且仅撤销本人申请',async()=>{
  execute=async s=>s.includes('COUNT(*)')?[{n:0}]:s.startsWith('UPDATE account_closures')?{affectedRows:1}:[];
  await close.apply('u',true);assert(sqls.some(([s])=>s.includes('INTERVAL 15 DAY')));await close.cancel('u');assert.deepEqual(sqls.find(([s])=>s.startsWith('UPDATE account_closures'))[1],['u']);
});
test('注销：冷静期拦截新业务，允许查阅、微信登录及撤销',async()=>{
  one=async()=>({userId:'u'});const u={id:'u'};
  await assert.rejects(close.guard({method:'POST',url:'/api/orders'},u),e=>e.status===409);
  for(const [method,url] of [['GET','/api/me'],['POST','/api/account-closure/cancel'],['POST','/api/auth/wx-login'],['POST','/api/auth/logout']])assert.equal(await close.guard({method,url},u),u);
});
test('注销：执行前再次校验；未完结事务只暂停，不删除档案',async()=>{
  run=async()=>[{userId:'u'}];execute=async s=>s.includes('FROM users')&&!s.includes('COUNT(*)')?[{id:'u'}]:s.includes('FROM account_closures')?[{userId:'u',status:'PENDING'}]:s.includes('COUNT(*)')?[{n:1}]:[];
  await close.sweep();assert(!sqls.some(([s])=>s.startsWith('UPDATE users SET')));assert(sqls.some(([s])=>s.includes('lastError=?')));
});
test('注销：到期执行去标识化并失效会话，不删除订单票据及证据',async()=>{
  run=async()=>[{userId:'u'}];execute=async s=>s.includes('FROM users')&&!s.includes('COUNT(*)')?[{id:'u'}]:s.includes('FROM account_closures')?[{userId:'u',status:'PENDING'}]:s.includes('COUNT(*)')?[{n:0}]:[];
  await close.sweep();const update=sqls.find(([s])=>s.startsWith('UPDATE users SET'))[0];assert.match(update,/sessionToken=NULL/);assert.match(update,/phone=NULL/);assert(!sqls.some(([s])=>/DELETE FROM (orders|payments|invoice_requests|support_evidence_blobs)/.test(s)));
});
