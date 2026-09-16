const {request}=require('./request');
async function upload(){
 return require('./private-image').uploadPrivate('ENTERPRISE');
}
async function preview(id,admin=false){try{const r=await request('GET',(admin?'/admin':'')+'/enterprise/documents/'+encodeURIComponent(id));if(r.url){wx.previewImage({current:r.url,urls:[r.url]});return;}const path=wx.env.USER_DATA_PATH+'/enterprise-'+id+(r.mime==='image/png'?'.png':'.jpg');await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:r.base64,encoding:'base64',success:resolve,fail:reject}));wx.previewImage({current:path,urls:[path]});}catch(e){wx.showToast({title:e.message||'材料读取失败',icon:'none'});}}
module.exports={upload,preview};
