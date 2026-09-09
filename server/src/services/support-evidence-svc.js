'use strict';
const crypto=require('node:crypto');
const {query,queryOne}=require('../db');
const {config}=require('../config');
const {newId,v}=require('../lib/util');
const {err}=require('../lib/http');
// 证据不进入现有“登录用户可直读”的云存储；加密存储，下载须验证归属/管理权限。
const key=()=>crypto.createHash('sha256').update(String(config.identityDataKey)).digest();
async function upload(userId,b){
  const base64=v.str(b.base64,'截图数据',{min:1,max:560000});
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw err.bad('截图数据格式错误');
  const bytes=Buffer.from(base64,'base64');if(bytes.length>400*1024)throw err.bad('压缩后截图不能超过400KB');
  const mime=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?'image/jpeg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':null;
  if(!mime)throw err.bad('仅支持JPEG/PNG截图');
  const recent=await queryOne('SELECT COUNT(*) n FROM support_evidence_blobs WHERE userId=? AND createdAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',[userId]);
  if(Number(recent.n)>=50)throw err.tooMany('今日证据上传数量已达上限');
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);
  const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);
  const payload=[iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');const id=newId();
  await query('INSERT INTO support_evidence_blobs(id,userId,mime,payload,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',[id,userId,mime,payload]);return {id,name:'证据截图'+(mime==='image/png'?'.png':'.jpg')};
}
async function read(id,userId,admin=false){
  const row=await queryOne('SELECT * FROM support_evidence_blobs WHERE id=?',[id]);if(!row||(!admin&&row.userId!==userId))throw err.notFound('证据不存在');
  const [iv,tag,bytes]=row.payload.split('.').map(x=>Buffer.from(x,'base64'));const decipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);
  return {mime:row.mime,base64:Buffer.concat([decipher.update(bytes),decipher.final()]).toString('base64')};
}
module.exports={upload,read};
