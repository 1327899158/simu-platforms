'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('选择只加入预览，最多10张；上传失败保留草稿与已上传ID，重试成功后清空',async()=>{
 let page, uploads=0, submits=0, fail=true, chosen=0;
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniapp/pages/dispute-detail/index.js'),'utf8'),{
  Page:p=>{page=p;},
  wx:{showToast(){},showLoading(){},hideLoading(){},chooseMedia(o){const count=o.count;chosen+=count;o.success({tempFiles:Array.from({length:count},(_,i)=>({tempFilePath:'/tmp/'+chosen+'-'+i+'.jpg'}))});o.complete();}},
  require:p=>p.endsWith('/request')?{
   upload:async()=>({id:'f'+(++uploads)}),
   request:async(_m,_p,b)=>{submits++;assert.equal(b.fileIds.length,10);assert.equal(b.description,'说明');if(fail)throw Error('offline');},
  }:{},
 });
 page.setData=p=>Object.assign(page.data,p);page.load=async()=>{};
 Object.assign(page.data,{id:'d',dispute:{evidenceOpen:true,myEvidenceCount:0},evidenceDescription:'说明'});
 page.addEvidence();page.addEvidence();page.addEvidence();
 assert.equal(page.data.pendingEvidence.length,10);assert.equal(uploads,0);assert.equal(submits,0);
 await page.submitEvidence();assert.equal(uploads,10);assert.equal(page.data.pendingEvidence.length,10);assert.equal(page.data.evidenceDescription,'说明');
 fail=false;await page.submitEvidence();assert.equal(uploads,10);assert.equal(submits,2);assert.equal(page.data.pendingEvidence.length,0);assert.equal(page.data.evidenceDescription,'');
 page.data.dispute.myEvidenceCount=19;page.addEvidence();assert.equal(page.data.pendingEvidence.length,1);
 page.removePendingEvidence({currentTarget:{dataset:{index:0}}});assert.equal(page.data.pendingEvidence.length,0);
 page.data.dispute.evidenceOpen=false;page.addEvidence();assert.equal(page.data.pendingEvidence.length,0);
});
