'use strict';
const {query,queryOne,tx,parseJson}=require('../db');const {ok,err,readJson}=require('../lib/http');const {v,newId}=require('../lib/util');const {requireUser}=require('../lib/auth-mw');const {requireAdmin,writeAdminAudit}=require('../lib/admin-mw');
const CATEGORIES=['账号异常','订单/交易','纠纷售后','发票问题','其他'];
const offset=q=>v.int(q.get('offset')||0,'offset',{min:0,max:1000000});
async function member(req){const u=await requireUser(req);if(!['CUSTOMER','ENGINEER'].includes(u.role))throw err.forbidden();return u;}
function validateAnnouncement(b){const title=v.str(b.title,'标题',{min:1,max:80}),content=v.str(b.content,'公告内容',{min:1,max:2000}),targetRole=v.oneOf(b.targetRole,'发布角色',['ALL','CUSTOMER','ENGINEER']);
 const startsAt=new Date(b.startsAt),endsAt=new Date(b.endsAt);if(!Number.isFinite(startsAt.getTime())||!Number.isFinite(endsAt.getTime())||startsAt>=endsAt)throw err.bad('结束时间必须晚于开始时间');if(typeof b.enabled!=='boolean')throw err.bad('请选择发布状态');return {title,content,targetRole,startsAt,endsAt};}
async function detail(id,userId,admin=false){const r=await queryOne('SELECT * FROM service_tickets WHERE id=?',[id]);if(!r||(!admin&&r.userId!==userId))throw err.notFound('工单不存在');const messages=await query('SELECT id,senderKind,content,createdAt FROM service_ticket_messages WHERE ticketId=? ORDER BY id DESC LIMIT 100',[id]);return {...r,evidence:parseJson(r.evidence),relatedOrder:r.relatedOrder?parseJson(r.relatedOrder,null):null,messages:messages.reverse()};}
function orderScope(user){return user.role==='CUSTOMER'?'o.customerId=?':'EXISTS(SELECT 1 FROM quotes q WHERE q.orderId=o.id AND q.engineerId=?)';}
function register(router){
 router.get('/api/service-ticket-orders',async(req,res,p,q)=>{
  const user=await member(req),args=[user.id];let where=orderScope(user);
  const id=v.str(q.get('id'),'订单ID',{max:32,optional:true});
  const search=v.str(q.get('search'),'搜索',{max:120,optional:true});
  if(id){where+=' AND o.id=?';args.push(id);}
  if(search){where+=' AND (o.projectName LIKE ? OR o.orderNo LIKE ?)';args.push('%'+search+'%','%'+search+'%');}
  const rows=await query(`SELECT o.id,o.projectName,o.orderNo FROM orders o WHERE o.deletedAt IS NULL AND ${where} ORDER BY o.createdAt DESC,o.id LIMIT 21 OFFSET ${offset(q)}`,args);
  ok(res,{items:rows.slice(0,20),hasMore:rows.length>20});
 });
 router.get('/api/announcements',async(req,res)=>{const u=await member(req);ok(res,{serverNow:new Date().toISOString(),items:await query("SELECT id,title,content,revision,endsAt FROM announcements WHERE enabled=1 AND startsAt<=UTC_TIMESTAMP(3) AND endsAt>UTC_TIMESTAMP(3) AND targetRole IN ('ALL',?) ORDER BY updatedAt DESC,id LIMIT 30",[u.role])});});
 router.get('/api/admin/announcements',async(req,res,p,q)=>{await requireAdmin(req,'ANNOUNCEMENT_MANAGE');const rows=await query(`SELECT * FROM announcements ORDER BY updatedAt DESC,id LIMIT 21 OFFSET ${offset(q)}`);ok(res,{items:rows.slice(0,20),hasMore:rows.length>20});});
 router.post('/api/admin/announcements',async(req,res)=>{const {admin}=await requireAdmin(req,'ANNOUNCEMENT_MANAGE'),b=await readJson(req),a=validateAnnouncement(b),id=b.id?v.str(b.id,'公告ID',{min:1,max:32}):newId();await tx(async c=>{
  if(b.id){const revision=v.int(b.revision,'版本',{min:1,max:1000000});const [r]=await c.execute('UPDATE announcements SET title=?,content=?,targetRole=?,startsAt=?,endsAt=?,enabled=?,revision=revision+1,updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND revision=?',[a.title,a.content,a.targetRole,a.startsAt,a.endsAt,b.enabled?1:0,id,revision]);if(!r.affectedRows)throw err.conflict('公告已修改，请刷新后重试');}
  else await c.execute('INSERT INTO announcements(id,title,content,targetRole,startsAt,endsAt,enabled,updatedAt) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',[id,a.title,a.content,a.targetRole,a.startsAt,a.endsAt,b.enabled?1:0]);
  await writeAdminAudit(req,admin,'ANNOUNCEMENT_SAVE','ANNOUNCEMENT',id,{...a,enabled:b.enabled},c);
 });ok(res,{id});});
 router.get('/api/admin/service-ticket-evidence/:id',async(req,res,p,q)=>{
  const {admin}=await requireAdmin(req,'CUSTOMER_SERVICE');
  const ticket=await queryOne('SELECT id FROM service_tickets WHERE JSON_CONTAINS(evidence, JSON_QUOTE(?)) LIMIT 1',[p.id]);
  if(!ticket)throw err.notFound('工单截图不存在');
  const image=await require('../services/support-evidence-svc').read(p.id,null,true);
  await writeAdminAudit(req,admin,'SERVICE_TICKET_EVIDENCE_READ','EVIDENCE',p.id);
  ok(res,require('../services/image-chunks').imageChunk(image,q));
 });
 router.post('/api/service-tickets',async(req,res)=>{const u=await member(req),b=await readJson(req),category=v.oneOf(b.category,'问题类型',CATEGORIES),title=v.str(b.title,'标题',{min:2,max:120}),content=v.str(b.content,'问题描述',{min:5,max:3000});const ids=v.arr(b.evidence||[],'截图',{maxLen:5}).map(id=>v.str(id,'图片ID',{min:1,max:32})),id=newId();await tx(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[u.id]);const [[count]]=await c.execute('SELECT COUNT(*) n FROM service_tickets WHERE userId=? AND createdAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',[u.id]);if(Number(count.n)>=10)throw err.tooMany('每天最多提交10个工单');
  for(const fid of ids){const [[f]]=await c.execute('SELECT id FROM support_evidence_blobs WHERE id=? AND userId=?',[fid,u.id]);if(!f)throw err.forbidden('只能使用自己的截图');}
  let relatedOrder=null;const orderId=v.str(b.orderId,'关联订单',{max:32,optional:true});
  if(orderId){
   const [[order]]=await c.execute(`SELECT o.id,o.projectName,o.orderNo FROM orders o WHERE o.id=? AND o.deletedAt IS NULL AND ${orderScope(u)} FOR UPDATE`,[orderId,u.id]);
   if(!order)throw err.forbidden('只能关联本人参与的订单');
   relatedOrder=JSON.stringify(order);
  }
  await c.execute("INSERT INTO service_tickets(id,userId,category,title,content,evidence,relatedOrder,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'OPEN',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,u.id,category,title,content,JSON.stringify([...new Set(ids)]),relatedOrder]);});ok(res,{id});});
 router.get('/api/service-tickets',async(req,res,p,q)=>{const u=await member(req),rows=await query(`SELECT id,title,category,status,updatedAt FROM service_tickets WHERE userId=? ORDER BY updatedAt DESC,id LIMIT 21 OFFSET ${offset(q)}`,[u.id]);ok(res,{items:rows.slice(0,20),hasMore:rows.length>20});});
 router.get('/api/service-tickets/:id',async(req,res,p)=>ok(res,await detail(p.id,(await member(req)).id)));
 router.get('/api/admin/service-tickets',async(req,res,p,q)=>{
  await requireAdmin(req,'CUSTOMER_SERVICE');
  // 老用户表与后建的客服表可能继承不同的 utf8mb4 排序规则。
  // 显式统一关联比较，兼容已有数据库，无需在启动时执行改表操作。
  const rows=await query(`SELECT t.*,u.nickname FROM service_tickets t
   JOIN users u ON u.id COLLATE utf8mb4_unicode_ci = t.userId COLLATE utf8mb4_unicode_ci
   ORDER BY (t.status IN ('OPEN','PROCESSING')) DESC,t.updatedAt DESC,t.id LIMIT 21 OFFSET ${offset(q)}`);
  ok(res,{items:rows.slice(0,20),hasMore:rows.length>20});
 });
 router.get('/api/admin/service-tickets/:id',async(req,res,p)=>{await requireAdmin(req,'CUSTOMER_SERVICE');ok(res,await detail(p.id,null,true));});
 for(const adminMode of [false,true])router.post('/api/'+(adminMode?'admin/':'')+'service-tickets/:id',async(req,res,p)=>{
  const actor=adminMode?await requireAdmin(req,'CUSTOMER_SERVICE'):{user:await member(req)},b=await readJson(req),action=v.oneOf(b.action,'操作',adminMode?['REPLY','ACCEPT','RESOLVE','CLOSE','REOPEN']:['REPLY','CLOSE','REOPEN']);const content=action==='REPLY'?v.str(b.content,'回复',{min:1,max:3000}):({ACCEPT:'客服已受理工单',RESOLVE:'客服标记问题已处理',CLOSE:'工单已关闭',REOPEN:'工单已重新打开'})[action];
  await tx(async c=>{const [[t]]=await c.execute('SELECT * FROM service_tickets WHERE id=? FOR UPDATE',[p.id]);if(!t||(!adminMode&&t.userId!==actor.user.id))throw err.notFound('工单不存在');
   if(action==='REOPEN'&&!['CLOSED','RESOLVED'].includes(t.status))throw err.conflict('工单尚未关闭或处理完成');
   if(action!=='REOPEN'&&t.status==='CLOSED')throw err.conflict('工单已关闭，请先重新打开');
   if(['ACCEPT','RESOLVE'].includes(action)&&!['OPEN','PROCESSING'].includes(t.status))throw err.conflict('当前状态不可操作');
   const status=action==='REOPEN'?'OPEN':action==='CLOSE'?'CLOSED':action==='RESOLVE'?'RESOLVED':adminMode?'PROCESSING':'OPEN';
   await c.execute('UPDATE service_tickets SET status=?,assignedAdminId=COALESCE(?,assignedAdminId),updatedAt=UTC_TIMESTAMP(3) WHERE id=?',[status,adminMode?actor.admin.id:null,p.id]);
   await c.execute('INSERT INTO service_ticket_messages(ticketId,senderId,senderKind,content,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',[p.id,adminMode?actor.admin.id:actor.user.id,action!=='REPLY'?'SYSTEM':adminMode?'STAFF':'USER',content]);
   if(adminMode)await writeAdminAudit(req,actor.admin,'TICKET_'+action,'SERVICE_TICKET',p.id,{content},c);
  });ok(res,{updated:true});
 });
}
module.exports={register,validateAnnouncement,CATEGORIES};
