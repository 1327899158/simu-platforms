'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const config={privateStorageEnabled:true,cloudbaseEnv:'env'};
let task,record,downloads,uploads,bytes;
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
mock('../src/config',{config});
mock('../src/db',{query:async()=>[],queryOne:async()=>null,tx:async fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT id FROM users'))return [[{id:'owner'}]];
 if(sql.startsWith('SELECT COUNT'))return [[{n:0}]];
 if(sql.startsWith('INSERT INTO private_upload_tasks')){task={id:a[0],userId:a[1],purpose:a[2],stagingFileId:a[3],finalFileId:a[4],finalPath:a[5],status:'PENDING',expiresAt:new Date(Date.now()+900000)};return [{}];}
 if(sql.startsWith('SELECT * FROM private_upload_tasks'))return [[task&&task.id===a[0]&&task.userId===a[1]?task:null].filter(Boolean)];
 if(sql.startsWith('INSERT INTO support_evidence_blobs')||sql.startsWith('INSERT INTO enterprise_documents')){record={id:a[0],userId:a[1],mime:a[2],payload:a[3]};return [{}];}
 if(sql.startsWith("UPDATE private_upload_tasks SET status='COMMITTED'")){task.status='COMMITTED';return [{}];}
 throw Error(sql);
}})});
mock('../src/tcb',{getStorage:()=>({
 getUploadMetadata:async({cloudPath})=>({data:{fileId:'cloud://env.bucket/'+cloudPath}}),
 getTempFileURL:async()=>({fileList:[{tempFileURL:'https://storage.test/file'}]}),
 uploadFile:async({cloudPath,fileContent})=>{uploads++;assert.deepEqual(fileContent,bytes);return {fileID:'cloud://env.bucket/'+cloudPath};}
})});
// No real cloud calls. Bound response stream exercises the size gate before upload.
const https=require('node:https');https.get=(url,callback)=>{
 downloads++;const req=new EventEmitter();req.destroy=e=>{req.emit('error',e);req.emit('close');};
 process.nextTick(()=>{const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',bytes);res.emit('end');req.emit('close');});return req;
};
const storage=require('../src/services/private-storage');
async function init(){record=null;downloads=uploads=0;bytes=Buffer.from([255,216,255,0]);return storage.begin({id:'owner',role:'CUSTOMER'},'SUPPORT','openid');}
test('未配置权限时默认拒绝；客户不能申请企业资质任务',async()=>{
 config.privateStorageEnabled=false;await assert.rejects(init(),e=>e.status===409);config.privateStorageEnabled=true;
 await assert.rejects(storage.begin({id:'owner',role:'CUSTOMER'},'ENTERPRISE','openid'),e=>e.status===403);
});
test('私密上传绑定业务账号、用途、文件ID和有效期',async()=>{
 const r=await init();
 for(const args of [['other','SUPPORT',r.taskId,task.stagingFileId],['owner','ENTERPRISE',r.taskId,task.stagingFileId],['owner','SUPPORT',r.taskId,'cloud://env.bucket/foreign']])await assert.rejects(storage.commit(...args),e=>e.status===403);
 assert.equal(downloads,0);task.expiresAt=new Date(0);await assert.rejects(storage.commit('owner','SUPPORT',r.taskId,task.stagingFileId),e=>e.status===409);
});
test('直传确认幂等，正式文件不可由客户端路径替换，预览返回URL不返回Base64',async()=>{
 const r=await init();const result=await storage.commit('owner','SUPPORT',r.taskId,task.stagingFileId);
 assert.notEqual(task.finalPath.split('/').pop(),r.taskId);
 assert.equal(result.id,r.taskId);assert.match(JSON.parse(record.payload).fileID,/private-documents\/support\//);
 await storage.commit('owner','SUPPORT',r.taskId,task.stagingFileId);assert.equal(uploads,1);
 const view=await storage.cloudView(record);assert.ok(view.url);assert.equal(view.base64,undefined);
 assert.equal(await storage.cloudView({payload:'iv.tag.encrypted'}),null);
});
test('后端拒绝非法格式和超过5MB的实际文件，不只相信前端大小',async()=>{
 let r=await init();bytes=Buffer.from('not an image');await assert.rejects(storage.commit('owner','SUPPORT',r.taskId,task.stagingFileId),e=>e.status===400);assert.equal(uploads,0);
 r=await init();bytes=Buffer.alloc(storage.LIMIT+1);await assert.rejects(storage.commit('owner','SUPPORT',r.taskId,task.stagingFileId),e=>e.status===400);assert.equal(uploads,0);
});
test('私密目录客户端无读权限，正式目录无写权限，普通目录维持原规则',()=>{
 const rules=require('../../docs/cloud-storage.rules.json');
 const evaluate=(expression,path)=>Function('auth','resource','return '+expression)({openid:'wx'},{openid:'wx',path});
 for(const p of ['private-staging/wx/id','private-documents/support/id'])assert.equal(evaluate(rules.read,p),false);
 assert.equal(evaluate(rules.write,'private-documents/support/id'),false);
 assert.equal(evaluate(rules.write,'private-staging/wx/id'),true);
 assert.equal(evaluate(rules.read,'uploads/wx/file'),true);
});
