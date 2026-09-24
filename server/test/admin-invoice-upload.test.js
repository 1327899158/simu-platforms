const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(source,cancel=false) {
 let page;const uploads=[],requests=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniapp/admin/pages/invoices/index.js'),'utf8'),{
  Page:p=>page=p,wx:{showModal:o=>o.success({confirm:true}),showToast(){},chooseMessageFile:o=>cancel?o.fail({errMsg:'chooseMessageFile:fail cancel'}):o.success({tempFiles:[{path:'/tmp/invoice.pdf',name:'invoice.pdf'}]}),chooseImage:o=>o.success({tempFilePaths:['/tmp/invoice.png']})},
  require:n=>n.endsWith('/request')?{upload:async(p,o)=>{uploads.push([p,o]);return {id:'file1'};},request:async(...a)=>{requests.push(a);return {};}}:{},
 });
 page.setData=p=>Object.assign(page.data,p);page.data.canProcess=true;page.load=async()=>{};
 return {page,uploads,requests,event:{currentTarget:{dataset:{id:'invoice1',source}}}};
}
test('管理员本地文档与相册图片通过同一上传与交付接口',async()=>{
 for(const source of ['file','image']){
  const s=setup(source);await s.page.deliverInvoice(s.event);
  assert.equal(s.uploads.length,1);assert.equal(s.uploads[0][1].kind,source==='file'?'DOC':'IMAGE');
  assert.equal(s.requests[0][1],'/admin/invoices/invoice1/files');assert.equal(s.requests[0][2].fileIds[0],'file1');assert.equal(s.page.data.processingId,'');
 }
});
test('取消选择不上传不交付，缺少处理权限不打开流程',async()=>{
 const s=setup('file',true);await s.page.deliverInvoice(s.event);assert.equal(s.uploads.length,0);assert.equal(s.requests.length,0);assert.equal(s.page.data.processingId,'');
 const denied=setup('file');denied.page.data.canProcess=false;await denied.page.deliverInvoice(denied.event);assert.equal(denied.uploads.length,0);
});
