'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const sessions=new Map(),documents=new Map(),support=new Map();
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
const lookup=(u,id)=>u+':'+id;
async function query(sql,a){
 if(sql.startsWith('SELECT COUNT(*) n FROM support_evidence_blobs'))return [{n:support.size}];
 if(sql.startsWith('INSERT INTO support_evidence_blobs')){support.set(a[0],{id:a[0],userId:a[1],mime:a[2],payload:a[3]});return {};}
 if(sql.startsWith('SELECT * FROM support_evidence_blobs'))return [support.get(a[0])].filter(Boolean);
 if(sql.startsWith('SELECT id FROM users')||sql.startsWith('DELETE FROM enterprise_document_uploads'))return [];
 if(sql.startsWith('SELECT * FROM enterprise_document_uploads'))return [sessions.get(lookup(a[0],a[1]))].filter(Boolean);
 if(sql.startsWith('SELECT COUNT(*) n FROM enterprise_document_uploads'))return [{n:[...sessions.values()].filter(s=>s.userId===a[0]).length}];
 if(sql.startsWith('SELECT COUNT(*) n FROM enterprise_documents'))return [{n:documents.size}];
 if(sql.startsWith('INSERT INTO enterprise_document_uploads')){sessions.set(lookup(a[0],a[1]),{userId:a[0],total:a[2],nextIndex:0,payload:a[3]});return {};}
 if(sql.startsWith('UPDATE enterprise_document_uploads')){Object.assign(sessions.get(lookup(a[3],a[4])),{nextIndex:a[0],payload:a[1],documentId:a[2]});return {};}
 if(sql.startsWith('INSERT INTO enterprise_documents')){documents.set(a[0],{id:a[0],userId:a[1],mime:a[2],payload:a[3]});return {};}
 if(sql.startsWith('SELECT * FROM enterprise_documents'))return [documents.get(a[0])].filter(Boolean);
 throw Error(sql);
}
mock('../src/db',{query,queryOne:async(...args)=>(await query(...args))[0],tx:async fn=>fn({execute:async(...args)=>[await query(...args)]})});
mock('../src/config',{config:{identityDataKey:'test-key'}});
const svc=require('../src/services/enterprise-documents');
test('400KB资质分段重组后加密保存，重试不重复写入，读取仍限制归属',async()=>{
 const bytes=crypto.randomBytes(400*1024);bytes.set([255,216,255]);const base64=bytes.toString('base64');
 const total=Math.ceil(base64.length/60000);let result;
 for(let index=0;index<total;index++){
  const body={uploadId:'upload1',index,total,base64:base64.slice(index*60000,(index+1)*60000)};
  result=await svc.upload('e',body);
  const retry=await svc.upload('e',body);assert.equal(retry.complete,result.complete);
  if(index<total-1)assert.equal(documents.size,0);
 }
 assert.equal(documents.size,1);assert.equal(result.complete,true);
 assert.equal((await svc.read(result.id,'e')).base64,base64);
 await assert.rejects(svc.read(result.id,'other'),e=>e.status===404);
 assert.equal((await svc.read(result.id,null,true)).base64,base64);
 assert.ok(!documents.get(result.id).payload.includes(base64.slice(0,100)));
 assert.ok(!sessions.get('e:enterprise_upload1').payload.includes(base64.slice(0,100)));
 await assert.rejects(svc.upload('other',{uploadId:'upload1',index:1,total,base64:base64.slice(60000,120000)}),e=>e.status===409);
 await assert.rejects(svc.upload('e',{uploadId:'oversized',index:0,total:1,base64:'A'.repeat(60004)}),e=>e.status===400);
 await assert.rejects(svc.upload('e',{uploadId:'upload1',index:0,total,base64:'B'.repeat(60000)}),e=>e.status===409);
});

test('举报分段与资质分段隔离，重试不重复入库且图片按段读取',async()=>{
 const evidence=require('../src/services/support-evidence-svc');
 const {imageChunk}=require('../src/services/image-chunks');
 const bytes=crypto.randomBytes(200*1024);bytes.set([255,216,255]);const base64=bytes.toString('base64');
 const total=Math.ceil(base64.length/60000);let result;
 for(let index=0;index<total;index++){
  const body={uploadId:'upload1',index,total,base64:base64.slice(index*60000,(index+1)*60000)};
  result=await evidence.upload('e',body);
  const retry=await evidence.upload('e',body);assert.equal(retry.complete,result.complete);
 }
 assert.equal(support.size,1);
 await assert.rejects(evidence.read(result.id,'other'),e=>e.status===404);
 const image=await evidence.read(result.id,null,true);let combined='';
 for(let index=0;index<total;index++){
  const part=imageChunk(image,new URLSearchParams({chunk:String(index)}));
  assert.ok(Buffer.byteLength(JSON.stringify(part))<65000);combined+=part.base64;
 }
 assert.equal(combined,base64);
 assert.throws(()=>imageChunk(image,new URLSearchParams({chunk:'999'})));
 assert.equal(imageChunk(image,new URLSearchParams()).base64,base64);
});

test('小程序每个请求小于100KB，最后一段响应丢失可重试',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=Buffer.alloc(400*1024,1).toString('base64');const calls=[];let lost=false;
 const sandbox={module:{exports:{}},wx:{
  chooseImage:o=>o.success({tempFilePaths:['image.jpg']}),compressImage:o=>o.success({tempFilePath:'compressed.jpg'}),
  getFileSystemManager:()=>({readFile:o=>o.success({data:source})}),
 },require:()=>({request:async(_m,_p,b)=>{
  calls.push(b);assert.ok(Buffer.byteLength(JSON.stringify(b))<65000);
  if(b.index===b.total-1){if(!lost){lost=true;throw Error('network');}return {id:'document'};}
  return {complete:false};
 }})};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniapp/utils/private-image.js'),'utf8'),sandbox);
 assert.equal((await sandbox.module.exports.uploadBase64('/enterprise/documents',source)).id,'document');
 assert.equal(calls.slice(0,-1).map(b=>b.base64).join(''),source);
 assert.deepEqual(calls.at(-1),calls.at(-2));
});
