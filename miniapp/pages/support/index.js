const {request}=require('../../utils/request');const {ensureLogin,getUser}=require('../../utils/auth');
const labels={SUBMITTED:'已提交',ACCEPTED:'已受理',INVESTIGATING:'调查中',RESOLVED:'已处理',REJECTED:'不予受理'};
Page({
 selectReason(e){this.setData({category:e.detail.value});},
 data:{targetId:'',kind:'FEEDBACK',content:'',category:'骚扰或不当言论',reasons:['骚扰或不当言论','诱导私下交易','虚假资质或案例','冒用身份','其他'],evidence:[],items:[],detail:null,offset:0,hasMore:false,busy:false,uploading:false,error:''},
 onLoad(q){if(q.targetId)this.setData({targetId:q.targetId,kind:'REPORT'});if(q.id)this._detailId=q.id;},
 onShow(){if(ensureLogin()){this.load();if(this._detailId)this.open({currentTarget:{dataset:{id:this._detailId}}});}},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 input(e){this.setData({content:e.detail.value});},reason(e){this.setData({category:this.data.reasons[Number(e.detail.value)]});},
 async load(more=false){try{const offset=more?this.data.offset:0;const r=await request('GET','/support',{offset});const items=r.items.map(x=>({...x,statusText:labels[x.status]}));this.setData({items:more?this.data.items.concat(items):items,offset:offset+20,hasMore:r.hasMore,error:''});}catch(e){this.setData({error:e.message});}},
 more(){this.load(true);},retry(){this.load();},
 async addEvidence(){
  if(this.data.uploading||this.data.busy||this.data.evidence.length>=5)return;
  this.setData({uploading:true});
  try{
    const r=await require('../../utils/private-image').uploadPrivate('SUPPORT');
    this.setData({evidence:this.data.evidence.concat(r)});
  }catch(e){require('../../utils/private-image').showError(e);}
  finally{this.setData({uploading:false});}
 },
 removeEvidence(e){if(!this.data.busy)this.setData({evidence:this.data.evidence.filter((x,i)=>i!==Number(e.currentTarget.dataset.index))});},
 preview(e){require('../../utils/community').previewEvidence(e.currentTarget.dataset.id);},
 async submit(){if(this.data.busy||this.data.uploading)return;this.setData({busy:true});try{await request('POST','/support',{kind:this.data.kind,targetId:this.data.targetId,category:this.data.category,content:this.data.content,evidence:this.data.evidence});this.setData({content:'',evidence:[],kind:'FEEDBACK',targetId:''});wx.showToast({title:'提交成功'});await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 async open(e){try{const d=await request('GET','/support/'+e.currentTarget.dataset.id);this.setData({detail:{...d,statusText:labels[d.status],events:d.events.map(x=>({...x,statusText:labels[x.status]}))}});}catch(e){wx.showToast({title:e.message,icon:'none'});}},back(){this.setData({detail:null});}
});
