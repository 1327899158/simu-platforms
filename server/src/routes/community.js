'use strict';
const {query,queryOne,tx,parseJson}=require('../db');
const {ok,readJson,err}=require('../lib/http');
const {v,newId}=require('../lib/util');
const {requireUser,requireEngineer}=require('../lib/auth-mw');
const {requireAdmin,writeAdminAudit}=require('../lib/admin-mw');
const favorites=require('../services/favorites-svc');
const support=require('../services/support-svc');
const coop=require('../services/cooperation-svc');
const closure=require('../services/account-closure-svc');
const incentives=require('../services/incentives-svc');
const benefits=require('../services/benefits-svc');
async function member(req){const u=await requireUser(req);if(!['CUSTOMER','ENGINEER'].includes(u.role))throw err.forbidden();return u;}
async function engineer(req){const u=await member(req);if(u.role!=='ENGINEER')throw err.forbidden('仅工程师可操作');return u;}
const offset=q=>v.int(q.get('offset')||0,'offset',{min:0,max:1000000});
const page=rows=>({items:rows.slice(0,20),hasMore:rows.length>20});
function register(router){
  router.post('/api/support/evidence',async(req,res)=>{const u=await member(req);ok(res,await require('../services/support-evidence-svc').upload(u.id,await readJson(req)));});
  router.get('/api/support/evidence/:id',async(req,res,p)=>{const u=await member(req);ok(res,await require('../services/support-evidence-svc').read(p.id,u.id));});
  router.get('/api/admin/support/evidence/:id',async(req,res,p)=>{const {admin}=await requireAdmin(req,'SUPPORT_MANAGE');const result=await require('../services/support-evidence-svc').read(p.id,null,true);await writeAdminAudit(req,admin,'SUPPORT_EVIDENCE_READ','EVIDENCE',p.id);ok(res,result);});
  router.get('/api/public-cases/:id',async(req,res,p)=>{await member(req);const s=favorites.source('CASE');const row=await queryOne(`SELECT t.id,t.title,t.summary,t.engineerId FROM ${s.from} WHERE t.id=? AND ${s.where}`,[p.id]);if(!row)throw err.notFound('案例不存在或已停止展示');ok(res,row);});
  router.get('/api/favorites',async(req,res,p,q)=>ok(res,await favorites.list((await member(req)).id,q.get('kind')||'ENGINEER',offset(q))));
  router.post('/api/favorites',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await favorites.add(u.id,b.kind,b.id));});
  router.post('/api/favorites/remove',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await favorites.remove(u.id,b.kind,b.ids));});
  router.get('/api/help',async(req,res)=>{await member(req);ok(res,await query('SELECT id,kind,title,content,updatedAt FROM help_articles WHERE enabled=1 ORDER BY sortOrder,id'));});
  router.get('/api/admin/help',async(req,res)=>{await requireAdmin(req,'HELP_MANAGE');ok(res,await query('SELECT * FROM help_articles ORDER BY sortOrder,id'));});
  router.post('/api/admin/help',async(req,res)=>{
    const {admin}=await requireAdmin(req,'HELP_MANAGE'),b=await readJson(req);
    const id=b.id?v.str(b.id,'ID',{min:1,max:32}):newId(),kind=v.oneOf(b.kind,'分类',['FAQ','ABOUT','HELP']),title=v.str(b.title,'标题',{min:2,max:120}),content=v.str(b.content,'内容',{min:2,max:10000}),sort=v.int(b.sortOrder||0,'排序',{min:0,max:9999});
    await tx(async conn=>{await conn.execute('INSERT INTO help_articles(id,kind,title,content,enabled,sortOrder,updatedAt) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE kind=VALUES(kind),title=VALUES(title),content=VALUES(content),enabled=VALUES(enabled),sortOrder=VALUES(sortOrder),updatedAt=VALUES(updatedAt)',[id,kind,title,content,b.enabled===true?1:0,sort]);await writeAdminAudit(req,admin,'HELP_SAVE','HELP',id,{title,enabled:b.enabled},conn);});ok(res,{id});
  });
  router.post('/api/support',async(req,res)=>ok(res,await support.create(await member(req),await readJson(req))));
  router.get('/api/support',async(req,res,p,q)=>{const u=await member(req);ok(res,page(await query(`SELECT id,kind,category,status,createdAt,result FROM support_submissions WHERE userId=? ORDER BY createdAt DESC,id DESC LIMIT 21 OFFSET ${offset(q)}`,[u.id])));});
  router.get('/api/support/:id',async(req,res,p)=>ok(res,await support.detail(p.id,(await member(req)).id)));
  router.get('/api/admin/support',async(req,res,p,q)=>{await requireAdmin(req,'SUPPORT_MANAGE');const kind=v.oneOf(q.get('kind')||'REPORT','类型',['REPORT','FEEDBACK']);ok(res,page(await query(`SELECT s.id,s.kind,s.category,s.status,s.createdAt,u.nickname FROM support_submissions s LEFT JOIN users u ON u.id=s.userId WHERE s.kind=? ORDER BY s.createdAt DESC,s.id DESC LIMIT 21 OFFSET ${offset(q)}`,[kind])));});
  router.get('/api/admin/support/:id',async(req,res,p)=>{await requireAdmin(req,'SUPPORT_MANAGE');ok(res,await support.detail(p.id,null,true));});
  router.post('/api/admin/support/:id',async(req,res,p)=>{const {admin}=await requireAdmin(req,'SUPPORT_MANAGE');ok(res,await support.process(req,admin,p.id,await readJson(req)));});
  router.get('/api/account-closure',async(req,res)=>ok(res,await closure.status((await member(req)).id)));
  router.post('/api/account-closure',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await closure.apply(u.id,b.confirmed));});
  router.post('/api/account-closure/cancel',async(req,res)=>ok(res,await closure.cancel((await member(req)).id)));
  router.get('/api/cooperation/settings',async(req,res)=>ok(res,await coop.settings((await engineer(req)).id)));
  router.post('/api/cooperation/settings',async(req,res)=>ok(res,await coop.saveSettings((await requireEngineer(req)).id,await readJson(req))));
  router.get('/api/cooperation/engineers/:id',async(req,res,p)=>{
    const u=await member(req);const target=await queryOne("SELECT u.id,u.nickname FROM users u JOIN identity_verifications iv ON iv.userId=u.id WHERE u.id=? AND u.role='ENGINEER' AND u.status='ACTIVE' AND u.deletedAt IS NULL AND iv.verifyStatus='APPROVED'",[p.id]);if(!target)throw err.notFound();
    const setting=await coop.settings(p.id);ok(res,{engineer:target,settings:setting,relation:await queryOne('SELECT id,status,terms FROM cooperation_relations WHERE customerId=? AND engineerId=?',[u.id,p.id])});
  });
  router.post('/api/cooperation/engineers/:id',async(req,res,p)=>ok(res,await coop.invite(await member(req),p.id,await readJson(req))));
  router.get('/api/cooperation',async(req,res,p,q)=>{const u=await member(req);const rows=await query(`SELECT r.*,c.nickname customerName,e.nickname engineerName FROM cooperation_relations r JOIN users c ON c.id=r.customerId JOIN users e ON e.id=r.engineerId WHERE r.customerId=? OR r.engineerId=? ORDER BY r.updatedAt DESC,r.id DESC LIMIT 21 OFFSET ${offset(q)}`,[u.id,u.id]);ok(res,page(rows.map(r=>({...r,terms:parseJson(r.terms)}))));});
  router.post('/api/cooperation/:id/respond',async(req,res,p)=>{const u=await member(req),b=await readJson(req);ok(res,await coop.respond(u,p.id,b.action));});
  router.get('/api/direct-demands',async(req,res,p,q)=>{const u=await member(req);ok(res,page(await query(`SELECT o.id,o.projectName,o.status,d.engineerId,u.nickname engineerName FROM direct_demands d JOIN orders o ON o.id=d.orderId JOIN users u ON u.id=d.engineerId WHERE (d.customerId=? OR d.engineerId=?) AND o.deletedAt IS NULL ORDER BY o.createdAt DESC,o.id DESC LIMIT 21 OFFSET ${offset(q)}`,[u.id,u.id])));});
  router.get('/api/direct-demands/:id',async(req,res,p)=>{const u=await member(req);await coop.assertScope(p.id,u.id);const d=await queryOne('SELECT * FROM direct_demands WHERE orderId=? AND (customerId=? OR engineerId=?)',[p.id,u.id,u.id]);ok(res,d?{...d,terms:parseJson(d.terms)}:null);});
  router.get('/api/incentives',async(req,res)=>{const u=await member(req);ok(res,{...await incentives.state(u.id,query,u.role),role:u.role,checkin:await benefits.checkState(u.id),badges:await benefits.badges(u.id),leaderboard:u.role==='ENGINEER'?await incentives.leaderboard():[]});});
  router.post('/api/incentives/claim',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await incentives.claim(u.id,b.key,u.role));});
}
module.exports={register};
