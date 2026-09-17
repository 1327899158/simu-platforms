'use strict';
const crypto=require('node:crypto');
const {query,queryOne,tx}=require('../db');
const {config}=require('../config');
const {newId,v}=require('../lib/util');
const {err}=require('../lib/http');
// 企业资质不进入现有“登录用户可直读”的云存储；加密存储，下载须验证归属/管理权限。
const key=()=>crypto.createHash('sha256').update(String(config.identityDataKey)).digest();
async function upload(userId,b,db={query,queryOne}){
  if (b.uploadId !== undefined) return uploadChunk(userId,b);
  const base64=v.str(b.base64,'资质图片数据',{min:1,max:560000});
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw err.bad('资质图片数据格式错误');
  const bytes=Buffer.from(base64,'base64');if(bytes.length>400*1024)throw err.bad('压缩后资质图片不能超过400KB');
  const mime=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;
  if(!mime)throw err.bad('仅支持JPEG/PNG资质图片');
  const recent=await db.queryOne('SELECT COUNT(*) n FROM enterprise_documents WHERE userId=? AND createdAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',[userId]);
  if(Number(recent.n)>=50)throw err.tooMany('今日企业资质上传数量已达上限');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const payload=[iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');const id=newId();
  await db.query('INSERT INTO enterprise_documents(id,userId,mime,payload,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',[id,userId,mime,payload]);return {id,name:'企业资质图片'+(mime==='image/png'?'.png':'.jpg')};
}
function seal(text) {
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const bytes=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);
  return [iv.toString('base64'),cipher.getAuthTag().toString('base64'),bytes.toString('base64')].join('.');
}
function unseal(payload) {
  const [iv,tag,bytes]=payload.split('.').map(x=>Buffer.from(x,'base64'));
  const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes),decipher.final()]).toString('utf8');
}
async function uploadChunk(userId,b) {
  const id=v.str(b.uploadId,'上传编号',{min:1,max:64});
  if(!/^[a-zA-Z0-9_-]+$/.test(id))throw err.bad('上传编号格式错误');
  const total=v.int(b.total,'分段数量',{min:1,max:10});
  const index=v.int(b.index,'分段序号',{min:0,max:total-1});
  const chunk=v.str(b.base64,'图片分段',{min:1,max:60000});
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(chunk)||chunk.length%4!==0||(index<total-1&&(chunk.length!==60000||chunk.includes('='))))throw err.bad('图片分段格式错误');
  return tx(async c=>{
    const db={query:async(sql,args)=>{const [rows]=await c.execute(sql,args);return rows;},queryOne:async(sql,args)=>{const [rows]=await c.execute(sql,args);return rows[0]||null;}};
    // 跨实例串行化同一用户的上传，防止重试产生重复材料。
    await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[userId]);
    await c.execute('DELETE FROM enterprise_document_uploads WHERE userId=? AND expiresAt<UTC_TIMESTAMP(3)',[userId]);
    let session=await db.queryOne('SELECT * FROM enterprise_document_uploads WHERE userId=? AND id=? FOR UPDATE',[userId,id]);
    if(!session){
      if(index!==0)throw err.conflict('上传已过期，请重新选择图片');
      const active=await db.queryOne('SELECT COUNT(*) n FROM enterprise_document_uploads WHERE userId=?',[userId]);
      if(Number(active.n)>=50)throw err.tooMany('上传次数过多，请稍后重试');
      session={total,nextIndex:0,payload:seal(''),documentId:null};
      await c.execute('INSERT INTO enterprise_document_uploads(userId,id,total,nextIndex,payload,expiresAt) VALUES(?,?,?,0,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR))',[userId,id,total,session.payload]);
    }
    if(Number(session.total)!==total||index>Number(session.nextIndex))throw err.conflict('图片分段顺序错误');
    let accumulated=unseal(session.payload);
    if(index<Number(session.nextIndex)){
      if(accumulated.slice(index*60000,index*60000+chunk.length)!==chunk)throw err.conflict('重复分段内容不一致');
      return session.documentId?{id:session.documentId,complete:true}:{complete:false,nextIndex:Number(session.nextIndex)};
    }
    accumulated+=chunk;
    if(accumulated.length>546136)throw err.bad('压缩后资质图片不能超过400KB');
    const document=index===total-1?await upload(userId,{base64:accumulated},db):null;
    await c.execute('UPDATE enterprise_document_uploads SET nextIndex=?,payload=?,documentId=? WHERE userId=? AND id=?',[index+1,seal(accumulated),document?.id||null,userId,id]);
    return document?{...document,complete:true}:{complete:false,nextIndex:index+1};
  });
}
async function read(id,userId,admin=false){
  const row=await queryOne('SELECT * FROM enterprise_documents WHERE id=?',[id]);if(!row||(!admin&&row.userId!==userId))throw err.notFound('企业资质不存在');
  const [iv,tag,bytes]=row.payload.split('.').map(x=>Buffer.from(x,'base64'));const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);
  return {mime:row.mime,base64:Buffer.concat([decipher.update(bytes),decipher.final()]).toString('base64')};
}
module.exports={upload,read};
