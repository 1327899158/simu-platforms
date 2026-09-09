'use strict';
const {query,queryOne,tx,parseJson}=require('../db');
const {v,newId}=require('../lib/util');
const {err}=require('../lib/http');
const {writeAdminAudit}=require('../lib/admin-mw');
const reasons=['骚扰或不当言论','诱导私下交易','虚假资质或案例','冒用身份','其他'];
const transitions={SUBMITTED:['ACCEPTED','REJECTED'],ACCEPTED:['INVESTIGATING','RESOLVED','REJECTED'],INVESTIGATING:['RESOLVED','REJECTED'],RESOLVED:[],REJECTED:[]};
async function evidenceFor(userId,input=[]) {
  const files=v.arr(input,'证据',{maxLen:5}).map(f=>({id:v.str(f.id,'证据ID',{min:1,max:32}),name:v.str(f.name,'截图名称',{min:1,max:120})}));
  if(new Set(files.map(f=>f.id)).size!==files.length)throw err.bad('证据不能重复');
  for(const f of files)if(!await queryOne('SELECT id FROM support_evidence_blobs WHERE id=? AND userId=?',[f.id,userId]))throw err.forbidden('只能提交本人证据');
  return files;
}
async function create(user,body) {
  const kind=v.oneOf(body.kind,'类型',['FEEDBACK','REPORT']);
  const content=v.str(body.content,'说明',{min:10,max:3000});
  let targetId=null,category='意见反馈';
  if(kind==='REPORT') {
    targetId=v.str(body.targetId,'举报用户',{min:1,max:32});
    if(targetId===user.id) throw err.bad('不能举报自己');
    if(!await queryOne("SELECT id FROM users WHERE id=? AND role IN ('CUSTOMER','ENGINEER') AND deletedAt IS NULL",[targetId])) throw err.notFound('举报对象不存在');
    category=v.oneOf(body.category,'举报原因',reasons);
  }
  const evidence=await evidenceFor(user.id,body.evidence||[]),id=newId();
  return tx(async conn=>{
    await conn.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
    const [[count]]=await conn.execute('SELECT COUNT(*) AS n FROM support_submissions WHERE userId=? AND createdAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',[user.id]);
    if(Number(count.n)>=10) throw err.tooMany('每天最多提交10次反馈或举报');
    await conn.execute("INSERT INTO support_submissions(id,userId,kind,targetId,category,content,evidence,status,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,'SUBMITTED',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[id,user.id,kind,targetId,category,content,JSON.stringify(evidence)]);
    await conn.execute("INSERT INTO support_events(id,submissionId,status,note,createdAt) VALUES(?,?,'SUBMITTED','已提交，等待平台受理',UTC_TIMESTAMP(3))",[newId(),id]);
    return {id};
  });
}
async function detail(id,userId,admin=false) {
  const row=await queryOne('SELECT * FROM support_submissions WHERE id=?'+(admin?'':' AND userId=?'),admin?[id]:[id,userId]);
  if(!row) throw err.notFound('记录不存在');
  return {...row,evidence:parseJson(row.evidence),events:await query('SELECT status,note,createdAt FROM support_events WHERE submissionId=? ORDER BY createdAt,id',[id])};
}
async function process(req,admin,id,body) {
  const status=v.oneOf(body.status,'处理状态',['ACCEPTED','INVESTIGATING','RESOLVED','REJECTED']);
  const note=v.str(body.note,'处理说明',{min:2,max:3000});
  return tx(async conn=>{
    const [[row]]=await conn.execute('SELECT * FROM support_submissions WHERE id=? FOR UPDATE',[id]);
    if(!row) throw err.notFound();
    if(!transitions[row.status]?.includes(status)) throw err.conflict('状态已变化或记录已结案');
    await conn.execute('UPDATE support_submissions SET status=?,result=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?',[status,note,id]);
    await conn.execute('INSERT INTO support_events(id,submissionId,status,note,adminId,createdAt) VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))',[newId(),id,status,note,admin.id]);
    await writeAdminAudit(req,admin,'SUPPORT_PROCESS',row.kind,id,{from:row.status,to:status,note},conn);
    return {updated:true};
  });
}
module.exports={create,detail,process,reasons,transitions,evidenceFor};
