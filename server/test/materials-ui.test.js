'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function source(name){return fs.readFileSync(path.resolve(__dirname,'../../miniapp',name),'utf8');}
test('企业认证选图和预览返回不重置表单，多选图片逐张保留',async()=>{
 let page,loads=0,uploads=0;
 vm.runInNewContext(source('pages/enterprise/index.js'),{
  Page:p=>page=p,wx:{showToast(){},stopPullDownRefresh(){},chooseImage:o=>{assert.equal(o.count,5);page.onShow();o.success({tempFilePaths:['a','b','c']});}},
  require:n=>n.endsWith('/request')?{request:async()=>{loads++;return null;}}:n.endsWith('/auth')?{ensureLogin:()=>({role:'ENGINEER'})}:{upload:async()=>({id:'image'+(++uploads)}),preview:()=>page.onShow()},
 });
 page.setData=p=>Object.assign(page.data,p);
 await page.load();page.data.companyName='已填企业';page.data.creditCode='信用代码';
 await page.add();page.onShow();page.onPullDownRefresh();
 assert.equal(loads,1);assert.equal(page.data.companyName,'已填企业');assert.equal(page.data.creditCode,'信用代码');
 assert.equal(page.data.evidence.length,3);
});
test('分段预览重组为原图片，拒绝错误分段并展示错误阶段',async()=>{
 const data='a'.repeat(130000);let output,previewed=false,modal,invalid=false;
 const sandbox={module:{exports:{}},wx:{env:{USER_DATA_PATH:'/tmp'},showLoading(){},hideLoading(){},
  getFileSystemManager:()=>({writeFile:o=>{output=o.data;o.success();}}),previewImage:o=>{previewed=true;o.success();},showModal:o=>modal=o},
  require:()=>({request:async(m,url,q)=>({mime:'image/jpeg',total:3,index:invalid?8:q.chunk,base64:data.slice(q.chunk*60000,(q.chunk+1)*60000)})})};
 vm.runInNewContext(source('utils/private-image.js'),sandbox);
 await sandbox.module.exports.preview('/admin/enterprise/documents/id');assert.equal(output,data);assert.equal(previewed,true);
 invalid=true;previewed=false;await sandbox.module.exports.preview('/admin/enterprise/documents/id');
 assert.equal(previewed,false);assert.match(modal.content,/读取材料/);
});
test('管理首页显示待办角标，返回时重新拉取，隐藏时停止轮询',async()=>{
 let page,timer,cleared=0,reads=0;
 vm.runInNewContext(source('admin/pages/dashboard/index.js'),{Page:p=>page=p,setInterval:fn=>{timer=fn;return 1;},clearInterval:()=>cleared++,wx:{},
  require:n=>n.endsWith('/navigation')?require('../../miniapp/admin/utils/navigation'):n.endsWith('/request')?{request:async(m,url)=>{if(url==='/admin/console/overview')return null;reads++;return {engineerReviews:{pending:1},pendingTasks:{enterprise:2,support:3,'customer-service':4,wallet:5,invoices:6,disputes:7}};}}:{loadAdmin:async()=>({}),hasPermission:()=>true,denyAndExit:m=>{throw Error(m);}},
 });
 page.setData=p=>Object.assign(page.data,p);
 await page.load();assert.equal(page.data.groups.flatMap(g=>g.items).find(m=>m.key==='enterprise').count,2);assert.equal(page.data.groups.flatMap(g=>g.items).find(m=>m.key==='support').count,3);
 page.onShow();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);
 await timer();assert.equal(reads,3);page.onHide();assert.ok(cleared>1);
});

test('管理材料优先使用后端授权链接，链接失败后仍可云文件直读',async()=>{
 let direct=0,failHttp=false;
 const sandbox={module:{exports:{}},console:{log(){},warn(){},error(){}},wx:{
  downloadFile:o=>failHttp?o.fail({errMsg:'domain blocked'}):o.success({statusCode:200,tempFilePath:'/tmp/a'}),
  cloud:{downloadFile:o=>{direct++;o.success({tempFilePath:'/tmp/b'});}},previewImage:o=>o.success(),
 }};
 vm.runInNewContext(source('utils/cloud-file.js'),sandbox);
 const info={fileID:'cloud://test/file',url:'https://example.com/signed',mime:'image/jpeg'};
 assert.equal((await sandbox.module.exports.downloadAndOpen(info)).mode,'previewed');assert.equal(direct,0);
 failHttp=true;assert.equal((await sandbox.module.exports.downloadAndOpen(info)).mode,'previewed');assert.equal(direct,1);
});
