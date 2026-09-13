const {request}=require('./request');
async function upload(){
 const chosen=await new Promise((resolve,reject)=>wx.chooseImage({count:1,sizeType:['compressed'],success:resolve,fail:reject}));
 const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:chosen.tempFilePaths[0],quality:65,compressedWidth:1600,success:resolve,fail:reject}));
 const r=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed.tempFilePath,encoding:'base64',success:resolve,fail:reject}));
 if(r.data.length>546136)throw Error('图片过大，请裁剪后重试，压缩后需小于400KB');
 return request('POST','/enterprise/documents',{base64:r.data});
}
async function preview(id,admin=false){try{const r=await request('GET',(admin?'/admin':'')+'/enterprise/documents/'+encodeURIComponent(id));const path=wx.env.USER_DATA_PATH+'/enterprise-'+id+(r.mime==='image/png'?'.png':'.jpg');await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:r.base64,encoding:'base64',success:resolve,fail:reject}));wx.previewImage({current:path,urls:[path]});}catch(e){wx.showToast({title:e.message||'材料读取失败',icon:'none'});}}
module.exports={upload,preview};
