const {request}=require('./request');
async function favorite(kind,id){try{await request('POST','/favorites',{kind,id});wx.showToast({title:'已收藏',icon:'success'});}catch(e){wx.showToast({title:e.message||'收藏失败',icon:'none'});}}
function report(id){if(id)wx.navigateTo({url:'/pages/support/index?targetId='+encodeURIComponent(id)});}
function confirm(title,content){return new Promise(resolve=>wx.showModal({title,content,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));}
function previewEvidence(id,admin=false,service=false) {
 return require('./private-image').preview(admin&&service?'/admin/service-ticket-evidence/'+encodeURIComponent(id):(admin?'/admin':'')+'/support/evidence/'+encodeURIComponent(id));
}
module.exports={favorite,report,confirm,previewEvidence};
