// 私密图片直传，业务接口仅传任务ID和文件ID。
const invoke=(fn,args)=>new Promise((resolve,reject)=>fn({...args,success:resolve,fail:reject}));
function showError(e){if(/cancel/i.test(e.errMsg||e.message||''))return;wx.showModal({title:'图片上传失败',content:e.message||e.errMsg||'请检查网络后重试',showCancel:false});}
async function uploadPrivate(purpose){
 const {request}=require('./request');
 if(!wx.cloud||!wx.cloud.uploadFile)throw Error('请在支持云开发的微信小程序中上传图片');
 const chosen=await invoke(wx.chooseImage.bind(wx),{count:1,sizeType:['compressed']});
 const original=chosen.tempFilePaths?.[0];if(!original)throw Error('未获取到图片');
 const fs=wx.getFileSystemManager();
 const size=async path=>(await invoke(fs.getFileInfo.bind(fs),{filePath:path})).size;
 let filePath=original,bytes=await size(original);
 // 不再为了业务请求包强压到60KB；仅在超过5MB时适度压缩。
 if(bytes>5*1024*1024){
  for(const [quality,compressedWidth] of [[80,2400],[65,2000]]){
   try{const c=await invoke(wx.compressImage.bind(wx),{src:original,quality,compressedWidth});const n=await size(c.tempFilePath);if(n<bytes){filePath=c.tempFilePath;bytes=n;}if(bytes<=5*1024*1024)break;}catch(_){}
  }
 }
 if(bytes>5*1024*1024)throw Error('图片超过5MB，请裁剪后重试');
 const task=await request('POST','/private-uploads',{purpose},{silent:true});
 const uploaded=await invoke(wx.cloud.uploadFile.bind(wx.cloud),{config:{env:task.envId},cloudPath:task.cloudPath,filePath});
 if(!uploaded.fileID)throw Error('云存储未返回文件ID');
 const endpoint=purpose==='ENTERPRISE'?'/enterprise/documents':'/support/evidence';
 // 保留同一任务重试，后端确认幂等；绝不在响应丢失时擅自删除云文件。
 try{return await request('POST',endpoint,{taskId:task.taskId,fileID:uploaded.fileID},{silent:true});}
 catch(e){if(/timeout|超时|network|网络/i.test(e.message||''))return request('POST',endpoint,{taskId:task.taskId,fileID:uploaded.fileID},{silent:true});throw e;}
}
module.exports={showError,uploadPrivate};
