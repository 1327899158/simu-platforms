'use strict';
const https=require('node:https');
const {query,queryOne,tx}=require('../db');
const {config}=require('../config');
const {getStorage}=require('../tcb');
const {err}=require('../lib/http');
const {newId}=require('../lib/util');
const LIMIT=5*1024*1024;
const TABLES={SUPPORT:'support_evidence_blobs',ENTERPRISE:'enterprise_documents'};
function enabled(){if(!config.privateStorageEnabled)throw err.conflict('私密图片直传尚未启用，请管理员先配置云存储权限');}
async function migrate(q){await q(`CREATE TABLE IF NOT EXISTS private_upload_tasks (
 id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,purpose VARCHAR(16) NOT NULL,
 stagingFileId VARCHAR(512) NOT NULL,finalFileId VARCHAR(512) NOT NULL,finalPath VARCHAR(255) NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'PENDING',createdAt DATETIME(3) NOT NULL,expiresAt DATETIME(3) NOT NULL,
 stagingCleaned TINYINT NOT NULL DEFAULT 0,INDEX(userId,createdAt)
 ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);}
function mimeOf(bytes){
 if(bytes.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 throw err.bad('仅支持JPG/PNG图片，请转换格式后重试');
}
async function metadata(path){const r=await getStorage().getUploadMetadata({cloudPath:path});if(r.code||!r.data?.fileId)throw err.bad('无法创建私密上传任务，请检查云存储配置');return r.data.fileId;}
async function begin(user,purpose,openid){
 enabled();if(!TABLES[purpose])throw err.bad('上传用途不正确');
 if(purpose==='ENTERPRISE'&&user.role!=='ENGINEER')throw err.forbidden('仅工程师可上传企业资质');
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(openid||''))throw err.bad('未获取到微信云上传身份，请在微信小程序中重试');
 return tx(async c=>{
  await c.execute('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
  const [[count]]=await c.execute('SELECT COUNT(*) n FROM private_upload_tasks WHERE userId=? AND createdAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)',[user.id]);
  if(Number(count.n)>=50)throw err.tooMany('今日私密图片上传次数已达上限');
  // Final key is independent of the client-visible task ID: clients must not
  // pre-create the archive object and become its owner under creator-only ACLs.
  const id=newId(),cloudPath=`private-staging/${openid}/${id}`,finalPath=`private-documents/${purpose.toLowerCase()}/${newId()}`;
  const stagingFileId=await metadata(cloudPath),finalFileId=await metadata(finalPath);
  await c.execute("INSERT INTO private_upload_tasks(id,userId,purpose,stagingFileId,finalFileId,finalPath,createdAt,expiresAt) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3),DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 15 MINUTE))",[id,user.id,purpose,stagingFileId,finalFileId,finalPath]);
  return {taskId:id,cloudPath,envId:config.cloudbaseEnv,maxBytes:LIMIT};
 });
}
async function urlFor(fileID){
 const r=await getStorage().getTempFileURL({fileList:[{fileID,maxAge:300}]});
 const file=r.fileList?.[0];if(r.code||!file?.tempFileURL)throw err.bad('图片访问地址获取失败，请重试');
 const url=new URL(file.tempFileURL);if(url.protocol!=='https:')throw err.bad('图片访问地址不安全');return url.href;
}
// 地址只能来自服务端SDK，拒绝重定向，下载时限制实际字节和超时。
function readLimited(url){return new Promise((resolve,reject)=>{
 const req=https.get(url,res=>{
  if(res.statusCode!==200){res.resume();reject(err.bad('尚未读取到上传图片，请重试'));return;}
  let size=0;const chunks=[];
  res.on('data',chunk=>{size+=chunk.length;if(size>LIMIT){req.destroy(err.bad('图片不能超过5MB'));return;}chunks.push(chunk);});
  res.on('error',reject);res.on('end',()=>resolve(Buffer.concat(chunks)));
 });
 const timeout=setTimeout(()=>req.destroy(Error('图片校验超时，请重试')),30000);
 req.on('error',reject);req.on('close',()=>clearTimeout(timeout));
});}
async function commit(userId,purpose,taskId,fileID){
 enabled();if(!TABLES[purpose])throw err.bad('上传用途不正确');
 return tx(async c=>{
  const [[t]]=await c.execute('SELECT * FROM private_upload_tasks WHERE id=? AND userId=? FOR UPDATE',[taskId,userId]);
  if(!t||t.purpose!==purpose||t.stagingFileId!==fileID)throw err.forbidden('上传任务或文件不属于当前账号');
  const name=purpose==='ENTERPRISE'?'企业资质图片':'证据截图';
  if(t.status==='COMMITTED')return {id:t.id,name};
  if(t.status!=='PENDING'||+new Date(t.expiresAt)<=Date.now())throw err.conflict('上传任务已过期，请重新选择图片');
  const bytes=await readLimited(await urlFor(t.stagingFileId));const mime=mimeOf(bytes);
  // 复制校验过的字节到客户端不可改写的正式目录，防止上传者覆盖已提交证据。
  const uploaded=await getStorage().uploadFile({cloudPath:t.finalPath,fileContent:bytes});
  if(uploaded.code||uploaded.fileID!==t.finalFileId)throw err.bad('私密图片保存失败，请重试');
  const payload=JSON.stringify({storage:'cloudbase-private-v1',fileID:t.finalFileId,size:bytes.length});
  await c.execute(`INSERT INTO ${TABLES[purpose]}(id,userId,mime,payload,createdAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))`,[t.id,userId,mime,payload]);
  await c.execute("UPDATE private_upload_tasks SET status='COMMITTED' WHERE id=?",[t.id]);
  return {id:t.id,name};
 });
}
async function cloudView(row){
 if(!String(row.payload).startsWith('{'))return null;
 const data=JSON.parse(row.payload);if(data.storage!=='cloudbase-private-v1')throw err.bad('图片存储记录异常');
 return {mime:row.mime,url:await urlFor(data.fileID)};
}
async function remove(fileID){const r=await getStorage().deleteFile({fileList:[fileID]});const item=r.fileList?.find(x=>(x.fileID||x.fileid)===fileID);return !r.code&&item&&['SUCCESS','0'].includes(String(item.code??item.status));}
let busy=false,timer;
async function sweep(){if(busy)return;busy=true;try{
 const rows=await query("SELECT id FROM private_upload_tasks WHERE stagingCleaned=0 AND createdAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) LIMIT 50");
 for(const row of rows)try{await tx(async c=>{
  const [[t]]=await c.execute('SELECT * FROM private_upload_tasks WHERE id=? FOR UPDATE',[row.id]);if(!t||t.stagingCleaned)return;
  // 只清理任务生成的临时对象和未完成任务的正式目录孤儿；已提交资料永久保留本记录。
  if(t.status!=='COMMITTED'&&!await remove(t.finalFileId))return;
  if(await remove(t.stagingFileId))await c.execute("UPDATE private_upload_tasks SET stagingCleaned=1,status=? WHERE id=?",[t.status==='COMMITTED'?'COMMITTED':'EXPIRED',t.id]);
 });}catch(e){console.error('[private-upload-cleanup]',row.id,e.message);}
 }finally{busy=false;}}
function start(){if(timer||!config.privateStorageEnabled)return;const run=()=>sweep().catch(e=>console.error('[private-upload-sweep]',e.message));run();timer=setInterval(run,3600000);timer.unref?.();}
module.exports={migrate,begin,commit,cloudView,start,sweep,mimeOf,LIMIT};
