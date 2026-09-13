const {request}=require('../../utils/request');const {ensureLogin}=require('../../utils/auth');const docs=require('../../utils/enterprise-documents');
Page({data:{record:null,companyName:'',creditCode:'',evidence:[],busy:false,uploading:false,ready:false,error:'',editable:false},
 onShow(){const u=ensureLogin();if(!u)return;if(u.role!=='ENGINEER'){wx.showToast({title:'仅工程师可申请',icon:'none'});return;}this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 async load(){try{const r=await request('GET','/enterprise');this.setData({record:r?{...r,statusText:({PENDING:'审核中',APPROVED:'企业已认证',REJECTED:'未通过，请修改后重新提交'})[r.status]}:null,companyName:r?.companyName||'',creditCode:r?.creditCode||'',evidence:r?.evidence||[],editable:!r||r.status==='REJECTED',ready:true,error:''});}catch(e){this.setData({error:e.message,ready:false});}},
 input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},
 async add(){if(this.data.uploading||this.data.busy||this.data.evidence.length>=5)return;this.setData({uploading:true});try{const r=await docs.upload();this.setData({evidence:this.data.evidence.concat(r.id)});}catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'上传失败',icon:'none'});}finally{this.setData({uploading:false});}},
 remove(e){if(!this.data.busy&&!this.data.uploading)this.setData({evidence:this.data.evidence.filter(x=>x!==e.currentTarget.dataset.id)});},preview(e){docs.preview(e.currentTarget.dataset.id);},
 async submit(){if(this.data.busy||this.data.uploading||!this.data.editable)return;this.setData({busy:true});try{await request('POST','/enterprise',{companyName:this.data.companyName,creditCode:this.data.creditCode,evidence:this.data.evidence});wx.showToast({title:'已提交审核'});await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}}
});
