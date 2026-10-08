'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),{EventEmitter}=require('node:events');
const mock=(p,exports)=>require.cache[require.resolve(p)]={exports,loaded:true};
const CODE='1234567890abcdef',config={inviteEnvVersion:'release'};
let state,queue=Promise.resolve(),calls,image,response;
async function execute(sql,a=[]){
 if(sql.startsWith('SELECT')){
  if(sql.includes('FROM invitation_codes'))return [[...(state.codes.filter(c=>sql.includes('code=?')?c.code===a[0]:c.userId===a[0]).map(x=>({...x})))]];
  if(sql.includes('FROM users')){const u=state.users[a[0]];return [[...(u&&(!sql.includes("status='ACTIVE'")||u.status==='ACTIVE')?[{...u}]:[])]];}
  if(sql.includes('FROM home_campaigns'))return [[...(state.enabled?[{id:'invite'}]:[])]];
  if(sql.includes('FROM invitation_relations'))return [[...(state.relations.filter(r=>r.inviteeId===a[0]).map(r=>({...r})))]];
  if(sql.startsWith('SELECT status,deletedAt FROM orders'))return [[{status:state.completed?'COMPLETED':'REFUND_PENDING',deletedAt:null}]];
  if(sql.includes('FROM orders')){assert.match(sql,/status='COMPLETED'/);assert.match(sql,/p.status='SUCCESS'/);assert.match(sql,/COALESCE\(p.grossAmountFen,p.amountFen\)/);assert.match(sql,/completedAt<=UTC_TIMESTAMP/);return [[...(state.completed?[{id:'first-order'}]:[])]];}
 }
 if(sql.startsWith('INSERT IGNORE INTO invitation_codes')){if(!state.codes.some(c=>c.userId===a[0]))state.codes.push({userId:a[0],code:a[1]});}
 else if(sql.startsWith('INSERT INTO invitation_relations'))state.relations.push({inviteeId:a[0],inviterId:a[1],code:a[2],createdAt:new Date(),firstRewardAt:null});
 else if(sql.startsWith('INSERT IGNORE INTO incentive_rewards')){const key=sql.includes('INVITE_REGISTER')?'INVITE_REGISTER':'INVITE_FIRST_ORDER';if(!state.rewards.some(r=>r.userId===a[1]&&r.inviteeId===a[2]&&r.key===key))state.rewards.push({userId:a[1],inviteeId:a[2],key,coins:key==='INVITE_REGISTER'?50:250});}
 else if(sql.startsWith('UPDATE invitation_relations'))Object.assign(state.relations.find(r=>r.inviteeId===a[1]),{firstOrderId:a[0],firstRewardAt:new Date()});
 else if(sql.startsWith('UPDATE invitation_codes SET qrBase64'))state.codes.find(c=>c.userId===a[1]).qrBase64=a[0];
 else if(sql.startsWith('UPDATE invitation_codes SET urlLink'))Object.assign(state.codes.find(c=>c.userId===a[3]),{urlLink:a[0],urlExpiresAt:a[1],linkEnvVersion:a[2]});
 else throw Error(sql);
 return [{affectedRows:1}];
}
const db={tx:fn=>{const run=queue.then(async()=>{const snapshot=structuredClone(state);try{return await fn({execute});}catch(e){state=snapshot;throw e;}});queue=run.catch(()=>{});return run;},query:async(sql,a=[])=>{
 if(sql.includes('SELECT COUNT(*) registered'))return [{registered:state.relations.length,firstOrders:state.relations.filter(r=>r.firstRewardAt).length}];
 if(sql.startsWith('SELECT u.nickname'))return state.relations.map(r=>({...r,nickname:'新用户'}));
 if(sql==='SELECT inviteeId FROM invitation_relations WHERE firstRewardAt IS NULL')return state.relations.filter(r=>!r.firstRewardAt);
 return (await execute(sql,a))[0];
},queryOne:async(sql,a)=>(await db.query(sql,a))[0]||null};
mock('../src/db',db);mock('../src/config',{config});mock('../src/routes/auth',{getWechatApiCredential:async()=>({queryName:'access_token',token:'secret'})});
https.request=(options,callback)=>{const req=new EventEmitter();req.setTimeout=()=>req;req.end=raw=>{calls.push({options,payload:JSON.parse(raw)});const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',response?Buffer.from(JSON.stringify(response)):image);res.emit('end');};return req;};
const svc=require('../src/services/invitation-svc');
beforeEach(()=>{state={codes:[{userId:'inviter',code:CODE}],users:{inviter:{id:'inviter',status:'ACTIVE',createdAt:new Date()},friend:{id:'friend',status:'ACTIVE',createdAt:new Date()},old:{id:'old',status:'ACTIVE',createdAt:new Date(Date.now()-86400000)}},relations:[],rewards:[],enabled:true,completed:false};calls=[];config.inviteEnvVersion='release';response=null;image=Buffer.from([137,80,78,71,13,10,26,10,1]);});
test('新注册好友归属邀请人，注册奖励50币，重复与并发绑定只发一次',async()=>{
 const results=await Promise.all(Array.from({length:4},()=>svc.accept({id:'friend'},CODE)));assert(results.every(r=>r.accepted));assert.equal(state.relations.length,1);assert.equal(state.rewards.length,1);assert.equal(state.rewards[0].coins,50);
});
test('无效、自邀、旧账号和已下线活动不发奖励',async()=>{
 await assert.rejects(svc.accept({id:'friend'},'invalid'),e=>e.status===400);assert.equal((await svc.accept({id:'friend'},'aaaaaaaaaaaaaaaa')).accepted,false);assert.equal((await svc.accept({id:'inviter'},CODE)).accepted,false);assert.equal((await svc.accept({id:'old'},CODE)).accepted,false);
 state.enabled=false;assert.equal((await svc.accept({id:'friend'},CODE)).accepted,false);assert.equal(state.rewards.length,0);
});
test('首单完成且支付成功后追加250币，定时重试不会重复发奖励',async()=>{
 await svc.accept({id:'friend'},CODE);await svc.sweep();assert.equal(state.rewards.length,1);state.completed=true;await svc.sweep();await svc.grantFirst('friend');await svc.sweep();assert.equal(state.rewards.length,2);assert.equal(state.rewards[1].coins,250);
 const summary=await svc.summary({id:'inviter'});assert.equal(summary.registered,1);assert.equal(summary.firstOrders,1);assert.equal(summary.earned,300);assert.equal(summary.sharePath,'/pages/guest-home/index?invite='+CODE);
});
test('个人小程序码带邀请码，读取真实图片并缓存；切换发布版本重新生成',async()=>{
 const qr=await svc.qr({id:'inviter'});assert.equal(qr.mime,'image/png');assert.equal(qr.image,image.toString('base64'));assert.equal(calls[0].payload.scene,'invite='+CODE);assert.equal(calls[0].payload.page,'pages/guest-home/index');assert.equal(calls[0].payload.env_version,'release');
 await svc.qr({id:'inviter'});assert.equal(calls.length,1);config.inviteEnvVersion='trial';await svc.qr({id:'inviter'});assert.equal(calls.length,2);
});
test('微信返回权限错误时明确失败，不把错误JSON当作二维码图片',async()=>{
 response={errcode:48001,errmsg:'api unauthorized'};await assert.rejects(svc.qr({id:'inviter'}),e=>e.status===409&&e.message.includes('48001'));assert.equal(state.codes[0].qrBase64,undefined);
});
test('个人链接带邀请码，30天有效，缓存期间复用，过期重新生成',async()=>{
 response={url_link:'https://wxaurl.cn/example'};const r=await svc.link({id:'inviter'});assert.equal(r.url,response.url_link);assert.equal(calls[0].payload.query,'invite='+CODE);assert.equal(calls[0].payload.expire_interval,30);await svc.link({id:'inviter'});assert.equal(calls.length,1);state.codes[0].urlExpiresAt=new Date(0);await svc.link({id:'inviter'});assert.equal(calls.length,2);
});
