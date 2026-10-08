'use strict';
const crypto=require('node:crypto'),https=require('node:https');
const {query,queryOne,tx}=require('../db'),{err}=require('../lib/http'),{newId,parseDbDate}=require('../lib/util');
const {config}=require('../config');
const PATH='pages/guest-home/index';
function code(value){if(typeof value!=='string'||!/^[a-f0-9]{16}$/i.test(value))throw err.bad('邀请码无效');return value.toLowerCase();}
async function ensure(userId){
 for(let attempt=0;attempt<3;attempt++){
  await query('INSERT IGNORE INTO invitation_codes(userId,code,updatedAt) VALUES(?,?,UTC_TIMESTAMP(3))',[userId,crypto.randomBytes(8).toString('hex')]);
  const row=await queryOne('SELECT * FROM invitation_codes WHERE userId=?',[userId]);if(row)return row;
 }
 throw err.conflict('邀请码生成失败，请重试');
}
async function summary(user){
 const row=await ensure(user.id);
 const stats=await queryOne('SELECT COUNT(*) registered,COALESCE(SUM(firstRewardAt IS NOT NULL),0) firstOrders FROM invitation_relations WHERE inviterId=?',[user.id]);
 const records=await query(`SELECT u.nickname,r.firstRewardAt,r.createdAt FROM invitation_relations r JOIN users u ON u.id COLLATE utf8mb4_unicode_ci=r.inviteeId WHERE r.inviterId=? ORDER BY r.createdAt DESC LIMIT 30`,[user.id]);
 const registered=Number(stats?.registered||0),firstOrders=Number(stats?.firstOrders||0);
 return {code:row.code,sharePath:'/'+PATH+'?invite='+row.code,registered,firstOrders,earned:registered*50+firstOrders*250,records,registerCoins:50,firstOrderCoins:250};
}
async function accept(user,value){
 const ccode=code(value);
 return tx(async c=>{
  const [[owner]]=await c.execute('SELECT userId FROM invitation_codes WHERE code=?',[ccode]);
  if(!owner||owner.userId===user.id)return {accepted:false,reason:'invalid-or-self'};
  for(const id of [owner.userId,user.id].sort())await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[id]);
  const [[inviter]]=await c.execute("SELECT id FROM users WHERE id=? AND status='ACTIVE' AND deletedAt IS NULL FOR UPDATE",[owner.userId]);
  const [[invitee]]=await c.execute("SELECT id,createdAt FROM users WHERE id=? AND status='ACTIVE' AND deletedAt IS NULL FOR UPDATE",[user.id]);
  const [[old]]=await c.execute('SELECT inviteeId FROM invitation_relations WHERE inviteeId=? FOR UPDATE',[user.id]);
  if(old)return {accepted:true,duplicate:true};
  const age=invitee?Date.now()-parseDbDate(invitee.createdAt).getTime():NaN;
  if(!inviter||!Number.isFinite(age)||age<0||age>10*60*1000)return {accepted:false,reason:'existing-user'};
  const [[campaign]]=await c.execute("SELECT id FROM home_campaigns WHERE id='invite' AND enabled=1 AND action='SHARE'");
  if(!campaign)return {accepted:false,reason:'campaign-disabled'};
  await c.execute('INSERT INTO invitation_relations(inviteeId,inviterId,code,createdAt) VALUES(?,?,?,UTC_TIMESTAMP(3))',[user.id,owner.userId,ccode]);
  await c.execute("INSERT IGNORE INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,'INVITE_REGISTER',?,50,'RESERVED',UTC_TIMESTAMP(3))",[newId(),owner.userId,user.id]);
  return {accepted:true};
 });
}
async function grantFirst(invitee){
 return tx(async c=>{
  const [[lookup]]=await c.execute('SELECT * FROM invitation_relations WHERE inviteeId=?',[invitee]);if(!lookup)return;
  const [[o]]=await c.execute(`SELECT o.id FROM orders o LEFT JOIN quotes q ON q.id COLLATE utf8mb4_unicode_ci=o.selectedQuoteId WHERE (o.customerId=? OR q.engineerId=?) AND o.status='COMPLETED' AND o.deletedAt IS NULL AND o.completedAt>=? AND o.completedAt<=UTC_TIMESTAMP(3) AND EXISTS(SELECT 1 FROM payments p WHERE p.orderId COLLATE utf8mb4_unicode_ci=o.id AND p.status='SUCCESS' AND COALESCE(p.grossAmountFen,p.amountFen)=o.finalAmountFen) ORDER BY o.completedAt,o.id LIMIT 1`,[invitee,invitee,lookup.createdAt]);
  if(!o)return;
  const [[current]]=await c.execute('SELECT status,deletedAt FROM orders WHERE id=? FOR UPDATE',[o.id]);if(!current||current.status!=='COMPLETED'||current.deletedAt)return;
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[lookup.inviterId]);
  const [[relation]]=await c.execute('SELECT * FROM invitation_relations WHERE inviteeId=? FOR UPDATE',[invitee]);if(!relation||relation.firstRewardAt)return;
  const [[active]]=await c.execute("SELECT id FROM users WHERE id=? AND status='ACTIVE' AND deletedAt IS NULL FOR UPDATE",[relation.inviterId]);if(!active)return;
  await c.execute("INSERT IGNORE INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,'INVITE_FIRST_ORDER',?,250,'RESERVED',UTC_TIMESTAMP(3))",[newId(),relation.inviterId,invitee]);
  await c.execute('UPDATE invitation_relations SET firstRewardAt=UTC_TIMESTAMP(3),firstOrderId=? WHERE inviteeId=?',[o.id,invitee]);
 });
}
let running=false;
async function sweep(){if(running)return;running=true;try{const rows=await query('SELECT inviteeId FROM invitation_relations WHERE firstRewardAt IS NULL');for(const r of rows){try{await grantFirst(r.inviteeId);}catch(e){console.error('[invitation-reward]',r.inviteeId,e.message);}}}finally{running=false;}}
function start(){const run=()=>sweep().catch(e=>console.error('[invitation-rewards]',e.message));run();const timer=setInterval(run,60000);timer.unref?.();}
async function wechat(path,payload){
 const credential=await require('../routes/auth').getWechatApiCredential();
 return new Promise((resolve,reject)=>{
  const data=JSON.stringify(payload),r=https.request({hostname:'api.weixin.qq.com',path:path+'?'+credential.queryName+'='+encodeURIComponent(credential.token),method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}},res=>{
   const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>1024*1024)r.destroy(Error('微信图片响应过大'));else chunks.push(b);});res.on('end',()=>{const buffer=Buffer.concat(chunks);if(res.statusCode!==200)return reject(err.conflict('微信邀请接口暂不可用'));if(buffer[0]===123){try{const body=JSON.parse(buffer.toString());if(Number(body.errcode||0))return reject(err.conflict('微信邀请接口失败（'+body.errcode+'）：'+String(body.errmsg||'').slice(0,180)));resolve(body);}catch(e){reject(e);}}else if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||buffer[0]===255&&buffer[1]===216)resolve({image:buffer.toString('base64'),mime:buffer[0]===255?'image/jpeg':'image/png'});else reject(err.conflict('微信未返回有效小程序码'));});
  });r.setTimeout(10000,()=>r.destroy(Error('微信邀请接口超时')));r.on('error',reject);r.end(data);
 });
}
async function qr(user){
 const row=await ensure(user.id);if(row.qrBase64){const cached=JSON.parse(row.qrBase64);if(cached.envVersion===(config.inviteEnvVersion||'release'))return cached;}
 const image=await wechat('/wxa/getwxacodeunlimit',{scene:'invite='+row.code,page:PATH,width:430,check_path:true,env_version:config.inviteEnvVersion||'release'});
 if(!image.image)throw err.conflict('小程序码生成失败');
 await query('UPDATE invitation_codes SET qrBase64=?,updatedAt=UTC_TIMESTAMP(3) WHERE userId=?',[JSON.stringify({...image,envVersion:config.inviteEnvVersion||'release'}),user.id]);return image;
}
async function link(user){
 const row=await ensure(user.id);if(row.urlLink&&row.linkEnvVersion===(config.inviteEnvVersion||'release')&&parseDbDate(row.urlExpiresAt).getTime()>Date.now()+3600000)return {url:row.urlLink,expiresAt:row.urlExpiresAt};
 const r=await wechat('/wxa/generate_urllink',{path:PATH,query:'invite='+row.code,env_version:config.inviteEnvVersion||'release',is_expire:true,expire_type:1,expire_interval:30});
 if(typeof r.url_link!=='string'||!/^https:\/\//.test(r.url_link))throw err.conflict('微信邀请链接生成失败');
 const expiresAt=new Date(Date.now()+30*86400000);await query('UPDATE invitation_codes SET urlLink=?,urlExpiresAt=?,linkEnvVersion=?,updatedAt=UTC_TIMESTAMP(3) WHERE userId=?',[r.url_link,expiresAt,config.inviteEnvVersion||'release',user.id]);return {url:r.url_link,expiresAt};
}
module.exports={summary,accept,qr,link,grantFirst,sweep,start,code};
