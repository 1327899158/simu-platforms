const {request}=require('./request');
async function upload(){
 const chosen=await new Promise((resolve,reject)=>wx.chooseImage({count:1,sizeType:['compressed'],success:resolve,fail:reject}));
 const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:chosen.tempFilePaths[0],quality:65,compressedWidth:1600,success:resolve,fail:reject}));
 const r=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed.tempFilePath,encoding:'base64',success:resolve,fail:reject}));
 if(r.data.length>546136)throw Error('图片过大，请裁剪后重试，压缩后需小于400KB');
 // 每段60KB，给云托管请求头和JSON外层留出余量；资质仍由后端加密保存。
 const uploadId=Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
 const total=Math.ceil(r.data.length/60000);
 let result;
 for(let index=0;index<total;index++){
  const body={uploadId,index,total,base64:r.data.slice(index*60000,(index+1)*60000)};
  try{result=await request('POST','/enterprise/documents',body,{silent:true});}
  catch(e){
   if(e.statusCode&&e.statusCode<500)throw e;
   // 服务端按上传编号和分段序号去重，响应丢失时可安全重试。
   result=await request('POST','/enterprise/documents',body,{silent:true});
  }
 }
 if(!result||!result.id)throw Error('资质上传未完成，请重试');
 return result;
}
async function preview(id,admin=false){try{const r=await request('GET',(admin?'/admin':'')+'/enterprise/documents/'+encodeURIComponent(id));const path=wx.env.USER_DATA_PATH+'/enterprise-'+id+(r.mime==='image/png'?'.png':'.jpg');await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:r.base64,encoding:'base64',success:resolve,fail:reject}));wx.previewImage({current:path,urls:[path]});}catch(e){wx.showToast({title:e.message||'材料读取失败',icon:'none'});}}
module.exports={upload,preview};
