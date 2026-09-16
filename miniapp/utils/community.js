const {request}=require('./request');
async function favorite(kind,id){try{await request('POST','/favorites',{kind,id});wx.showToast({title:'已收藏',icon:'success'});}catch(e){wx.showToast({title:e.message||'收藏失败',icon:'none'});}}
function report(id){if(id)wx.navigateTo({url:'/pages/support/index?targetId='+encodeURIComponent(id)});}
function confirm(title,content){return new Promise(resolve=>wx.showModal({title,content,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));}
async function previewEvidence(id,admin=false) {
  try {
    const r=await request('GET',(admin?'/admin':'')+'/support/evidence/'+encodeURIComponent(id));
    const path=wx.env.USER_DATA_PATH+'/support-'+id+(r.mime==='image/png'?'.png':'.jpg');
    await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath:path,data:r.base64,encoding:'base64',success:resolve,fail:reject}));
    wx.previewImage({urls:[path],current:path});
  } catch(e) {wx.showToast({title:e.message||'证据读取失败',icon:'none'});}
}
module.exports={favorite,report,confirm,previewEvidence};
