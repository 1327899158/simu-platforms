const test=require('node:test'),assert=require('node:assert/strict');
let calls=[],size=200000;
require.cache[require.resolve('../../miniapp/utils/request')]={exports:{request:async(method,path,body)=>{calls.push({path,body});return path==='/private-uploads'?{taskId:'task',cloudPath:'private-staging/wx/task',envId:'env'}:{id:'task'};}}};
const {uploadPrivate}=require('../../miniapp/utils/private-image');
function setup(){calls=[];size=200000;global.wx={chooseImage:o=>o.success({tempFilePaths:['original']}),getFileSystemManager:()=>({getFileInfo:o=>o.success({size})}),cloud:{uploadFile:o=>{assert.equal(o.cloudPath,'private-staging/wx/task');o.success({fileID:'cloud://env/private-staging/wx/task'});}}};}
test('大于100KB图片走直传，业务接口没有Base64',async()=>{
 setup();assert.equal((await uploadPrivate('SUPPORT')).id,'task');assert.equal(calls.length,2);
 assert.equal(calls[1].path,'/support/evidence');assert.equal(calls[1].body.taskId,'task');assert.equal(calls[1].body.base64,undefined);assert.ok(JSON.stringify(calls[1].body).length<1024);
});
test('超过5MB图片无法压缩时不创建上传任务',async()=>{
 setup();size=6*1024*1024;await assert.rejects(uploadPrivate('SUPPORT'),/5MB/);assert.equal(calls.length,0);
});
test('取消选图不创建任务，企业资质使用对应确认接口',async()=>{
 setup();wx.chooseImage=o=>o.fail({errMsg:'chooseImage:fail cancel'});await assert.rejects(uploadPrivate('SUPPORT'),e=>e.errMsg.includes('cancel'));assert.equal(calls.length,0);
 setup();await uploadPrivate('ENTERPRISE');assert.equal(calls[1].path,'/enterprise/documents');
});
