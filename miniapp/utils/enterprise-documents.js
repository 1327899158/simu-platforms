const images=require('./private-image');
async function upload(path){
 if(!path){const chosen=await new Promise((resolve,reject)=>wx.chooseImage({count:1,sizeType:['compressed'],success:resolve,fail:reject}));path=chosen.tempFilePaths[0];}
 const compressed=await new Promise((resolve,reject)=>wx.compressImage({src:path,quality:65,compressedWidth:1600,success:resolve,fail:reject}));
 const r=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed.tempFilePath,encoding:'base64',success:resolve,fail:reject}));
 return images.uploadBase64('/enterprise/documents',r.data);
}
function preview(id,admin=false){return images.preview((admin?'/admin':'')+'/enterprise/documents/'+encodeURIComponent(id));}
module.exports={upload,preview};
