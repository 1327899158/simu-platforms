'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup({denied=false,directFail=false,tempFail=false}={}){
 let component,downloads=0,tempRequests=0;
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniapp/components/case-gallery/index.js'),'utf8'),{
  Component:c=>{component=c;},console:{warn(){}},
  wx:{cloud:{downloadFile(o){downloads++;if(directFail)o.fail({errMsg:'direct failed'});else o.success({tempFilePath:'/local/image.jpg'});}},showToast(){},previewImage(){}},
  require:p=>p.endsWith('/request')?{request:async(_m,url)=>{assert.equal(url,'/files/f/url');if(denied)throw Object.assign(Error('无权下载'),{statusCode:403});return {fileID:'cloud://env/img'};}}
   :{getTempFileUrl:async()=>{tempRequests++;if(tempFail)throw Error('temp failed');return 'https://example.test/image.jpg';}},
 });
 const instance={...component.methods,properties:{ids:['f']},data:{pictures:[]},setData(patch){
  for(const [key,value] of Object.entries(patch)){
   const m=/^pictures\[(\d+)\]$/.exec(key);if(m)this.data.pictures[Number(m[1])]=value;else this.data[key]=value;
  }
 }};
 return {instance,counts:()=>({downloads,tempRequests})};
}
test('案例预览先鉴权，直下成功无需服务端或客户端签发链接',async()=>{
 const {instance,counts}=setup();await instance.load();
 assert.equal(instance.data.pictures[0].url,'/local/image.jpg');assert.equal(counts().tempRequests,0);
 instance.imageError({currentTarget:{dataset:{id:'f',url:'/local/image.jpg'}},detail:{errMsg:'decode failed'}});
 assert.equal(instance.data.pictures[0].error,true);assert.equal(instance.data.pictures[0].url,'');
 await instance.load();assert.equal(instance.data.pictures[0].error,false);
});
test('直下失败可使用临时链接；读取失败保留原因，权限拒绝不尝试云存储',async()=>{
 const fallback=setup({directFail:true});await fallback.instance.load();assert.match(fallback.instance.data.pictures[0].url,/https:/);
 const broken=setup({directFail:true,tempFail:true});await broken.instance.load();assert.equal(broken.instance.data.pictures[0].error,true);assert.match(broken.instance.data.pictures[0].message,/direct failed/);
 const denied=setup({denied:true});await denied.instance.load();assert.equal(denied.counts().downloads,0);assert.equal(denied.counts().tempRequests,0);
});
