'use strict';
const {query,queryOne,tx,parseJson}=require('../db');
const {requireUser}=require('../lib/auth-mw');
const {requireAdmin,writeAdminAudit}=require('../lib/admin-mw');
const {ok,readJson,err}=require('../lib/http');
const {v}=require('../lib/util');
const delivery=require('../services/delivery-svc');
const documents=require('../services/enterprise-documents');
async function engineer(req){const u=await requireUser(req);if(u.role!=='ENGINEER')throw err.forbidden('仅工程师可申请企业认证');return u;}
async function badge(id){const r=await queryOne("SELECT companyName FROM enterprise_certifications WHERE userId=? AND status='APPROVED'",[id]);return r?{companyName:r.companyName,label:'企业已认证'}:null;}
function register(router){
  router.get('/api/orders/:id/delivery',async(req,res,p)=>{const u=await requireUser(req),overdue=await require('../services/overdue-svc').inspect(p.id,u);ok(res,{...await delivery.run(u,p.id),overdue});});
  router.post('/api/orders/:id/delivery/nudge',async(req,res,p)=>ok(res,await require('../services/overdue-svc').inspect(p.id,await requireUser(req),true)));
  for(const action of ['apply','respond'])router.post('/api/orders/:id/delivery/'+action,async(req,res,p)=>{
    const u=await requireUser(req);await require('../services/overdue-svc').inspect(p.id,u);
    const result=await delivery.run(u,p.id,action,await readJson(req));
    await require('../services/chat-svc').systemMessageForOrder(p.id,action==='apply'?'工程师提交了延期申请，请客户进入订单详情审批。':'客户已处理延期申请，请进入订单详情查看结果。').catch(e=>console.error('[extension-message]',e.message));ok(res,result);
  });
  router.post('/api/enterprise/documents',async(req,res)=>ok(res,await documents.upload((await engineer(req)).id,await readJson(req))));
  router.get('/api/enterprise/documents/:id',async(req,res,p)=>ok(res,await documents.read(p.id,(await engineer(req)).id)));
  router.get('/api/enterprise',async(req,res)=>{const r=await queryOne('SELECT * FROM enterprise_certifications WHERE userId=?',[(await engineer(req)).id]);ok(res,r?{...r,evidence:parseJson(r.evidence)}:null);});
  router.post('/api/enterprise',async(req,res)=>{
    const u=await engineer(req),b=await readJson(req),name=v.str(b.companyName,'企业名称',{min:2,max:120}),code=v.str(b.creditCode,'统一社会信用代码',{min:18,max:18}).toUpperCase();
    if(!/^[0-9A-HJ-NPQRTUWXY]{18}$/.test(code))throw err.bad('统一社会信用代码格式不正确');
    if(!Array.isArray(b.evidence)||b.evidence.length<1||b.evidence.length>5)throw err.bad('请上传1至5张营业执照或资质图片');
    const ids=[...new Set(b.evidence.map(x=>v.str(x,'材料ID',{min:1,max:32})))];
    await tx(async c=>{
      await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[u.id]);
      const [[old]]=await c.execute('SELECT status FROM enterprise_certifications WHERE userId=? FOR UPDATE',[u.id]);
      if(old&&['PENDING','APPROVED'].includes(old.status))throw err.conflict('审核中或已通过的认证不能重复提交');
      for(const id of ids){const [[f]]=await c.execute('SELECT id FROM enterprise_documents WHERE id=? AND userId=?',[id,u.id]);if(!f)throw err.forbidden('认证材料不属于当前账号');}
      try{if(old)await c.execute("UPDATE enterprise_certifications SET companyName=?,creditCode=?,evidence=?,status='PENDING',result=NULL,reviewedAt=NULL,submittedAt=UTC_TIMESTAMP(3),revision=revision+1 WHERE userId=?",[name,code,JSON.stringify(ids),u.id]);
      else await c.execute("INSERT INTO enterprise_certifications(userId,companyName,creditCode,evidence,status,submittedAt) VALUES(?,?,?,?,'PENDING',UTC_TIMESTAMP(3))",[u.id,name,code,JSON.stringify(ids)]);
      }catch(e){if(e.code==='ER_DUP_ENTRY')throw err.conflict('该企业已被其他账号提交');throw e;}
    });ok(res,{submitted:true});
  });
  router.get('/api/admin/enterprise',async(req,res,p,q)=>{
    await requireAdmin(req,'IDENTITY_APPROVE');
    const offset=v.int(q.get('offset')||0,'页码',{min:0,max:1000000});
    // 后建的企业表可能与 users 使用不同默认排序规则，显式统一关联比较。
    const rows=await query(`SELECT e.*,u.nickname FROM enterprise_certifications e
      JOIN users u ON u.id COLLATE utf8mb4_unicode_ci = e.userId COLLATE utf8mb4_unicode_ci
      ORDER BY (e.status='PENDING') DESC,e.submittedAt DESC,e.userId LIMIT 21 OFFSET ${offset}`);
    ok(res,{items:rows.slice(0,20).map(r=>({...r,evidence:parseJson(r.evidence)})),hasMore:rows.length>20});
  });
  router.get('/api/admin/enterprise/documents/:id',async(req,res,p)=>{const {admin}=await requireAdmin(req,'IDENTITY_APPROVE');const d=await documents.read(p.id,null,true);await writeAdminAudit(req,admin,'ENTERPRISE_DOCUMENT_READ','ENTERPRISE',p.id);ok(res,d);});
  router.post('/api/admin/enterprise/:id',async(req,res,p)=>{const {admin,user}=await requireAdmin(req,'IDENTITY_APPROVE'),b=await readJson(req);if(user.id===p.id)throw err.forbidden('不能审核自己的企业认证');const status=v.oneOf(b.status,'审核决定',['APPROVED','REJECTED']),result=v.str(b.result,'审核意见',{min:2,max:1000}),revision=v.int(b.revision,'申请版本',{min:1,max:1000000});
    await tx(async c=>{const [r]=await c.execute("UPDATE enterprise_certifications SET status=?,result=?,reviewedAt=UTC_TIMESTAMP(3) WHERE userId=? AND status='PENDING' AND revision=?",[status,result,p.id,revision]);if(!r.affectedRows)throw err.conflict('申请已处理或版本已变化，请刷新');await writeAdminAudit(req,admin,'ENTERPRISE_'+status,'ENTERPRISE',p.id,{result,revision},c);});ok(res,{reviewed:true});
  });
}
module.exports={register,badge};
