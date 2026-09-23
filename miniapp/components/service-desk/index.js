const {request}=require('../../utils/request');
const labels={OPEN:'待回应',PROCESSING:'处理中',RESOLVED:'已处理',CLOSED:'已关闭'};
Component({properties:{admin:Boolean,suggestedOrderId:String},data:{selectedOrder:null,orderPicker:false,orderItems:[],orderSearch:"",orderOffset:0,orderHasMore:false,orderLoading:false,orderError:"",items:[],detail:null,form:false,title:'',content:'',category:'账号异常',categories:['账号异常','订单/交易','纠纷售后','发票问题','其他'],reply:'',evidence:[],faq:[],busy:false,error:'',offset:0,hasMore:false},lifetimes:{attached(){this.start();},detached(){this.stop();}},pageLifetimes:{show(){this.start();},hide(){this.stop();}},methods:{
 keyboardChange(e){this.setData({keyboardHeight:Math.max(0,Number(e.detail.height)||0)});},
 sendReply(){return this.action({currentTarget:{dataset:{action:'REPLY'}}});},
 async chooseOrder(){
  if(this.data.busy)return;
  this.setData({orderPicker:true,orderSearch:'',orderItems:[],orderOffset:0,orderError:''});
  await this.loadOrders(false);
 },
 closeOrderPicker(){this.setData({orderPicker:false});},
 orderSearchInput(e){this.setData({orderSearch:e.detail.value});},
 searchOrders(){this.loadOrders(false);},
 moreOrders(){this.loadOrders(true);},
 async loadOrders(more=false){
  if(this.data.orderLoading)return;
  this.setData({orderLoading:true,orderError:''});
  try{
   const offset=more?this.data.orderOffset:0;
   const r=await request('GET','/service-ticket-orders',{offset,search:this.data.orderSearch},{silent:true});
   if(!more&&!this.data.orderSearch&&this.data.suggestedOrderId){const current=await request('GET','/service-ticket-orders',{id:this.data.suggestedOrderId},{silent:true});if(current.items[0])r.items=[current.items[0]].concat(r.items.filter(o=>o.id!==current.items[0].id));}
   this.setData({orderItems:more?this.data.orderItems.concat(r.items):r.items,orderOffset:offset+20,orderHasMore:r.hasMore});
  }catch(e){this.setData({orderError:e.message});}finally{this.setData({orderLoading:false});}
 },
 selectOrder(e){const order=this.data.orderItems.find(o=>o.id===e.currentTarget.dataset.id);if(order)this.setData({selectedOrder:order,orderPicker:false});},
 removeOrder(){if(!this.data.busy)this.setData({selectedOrder:null});},
 base(){return (this.data.admin?'/admin':'')+'/service-tickets';},start(){if(this._active)return;this._active=true;this.load();if(!this.data.admin)request('GET','/help',null,{silent:true}).then(faq=>{if(this._active)this.setData({faq:faq.filter(x=>x.kind==='FAQ')});}).catch(()=>{});this._poll=setInterval(()=>{if(this.data.detail){if(!this._detailLoading)this.openId(this.data.detail.id);}else if(!this.data.form && this.data.offset<=20)this.load();},2000);},stop(){this._active=false;this._detailVersion=(this._detailVersion||0)+1;clearInterval(this._poll);},
 async load(more=false){try{const offset=more===true?this.data.offset:0,r=await request('GET',this.base(),{offset});if(!this._active)return;const items=r.items.map(x=>({...x,statusText:labels[x.status]}));this.setData({items:more===true?this.data.items.concat(items):items,offset:offset+20,hasMore:r.hasMore,error:''});}catch(e){if(this._active)this.setData({error:e.message});}},more(){this.load(true);},
 create(){this._detailVersion=(this._detailVersion||0)+1;this.setData({form:true,detail:null});},cancel(){this.setData({form:false});},input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},category(e){this.setData({category:this.data.categories[Number(e.detail.value)]});},
 async addImage(){if(this.data.busy||this.data.evidence.length>=5)return;this.setData({busy:true});try{const image=await new Promise((resolve,reject)=>wx.chooseImage({count:1,sizeType:['compressed'],success:resolve,fail:reject}));const c=await new Promise((resolve,reject)=>wx.compressImage({src:image.tempFilePaths[0],quality:30,compressedWidth:1200,success:resolve,fail:reject}));const f=await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:c.tempFilePath,encoding:'base64',success:resolve,fail:reject}));if(f.data.length>546136)throw Error('截图过大，请裁剪后重试');const r=await require('../../utils/private-image').uploadBase64('/support/evidence',f.data);this.setData({evidence:this.data.evidence.concat(r.id)});}catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'上传失败',icon:'none'});}finally{this.setData({busy:false});}},remove(e){if(!this.data.busy)this.setData({evidence:this.data.evidence.filter(x=>x!==e.currentTarget.dataset.id)});},
 async submit(){if(this.data.busy)return;this.setData({busy:true});try{const r=await request('POST',this.base(),{category:this.data.category,title:this.data.title,content:this.data.content,evidence:this.data.evidence,orderId:this.data.selectedOrder?.id});this.setData({form:false,title:'',content:'',evidence:[],selectedOrder:null});await this.load();await this.openId(r.id);}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 open(e){this.openId(e.currentTarget.dataset.id);},async openId(id){this._detailLoading=true;const version=this._detailVersion=(this._detailVersion||0)+1;try{const r=await request('GET',this.base()+'/'+id,null,{silent:true});if(this._active&&version===this._detailVersion){const last=r.messages[r.messages.length-1]?.id;const previous=this.data.detail?.messages||[];const changed=!this.data.detail||this.data.detail.id!==r.id||last!==previous[previous.length-1]?.id;this.setData({detail:{...r,statusText:labels[r.status]},error:''});if(changed)this.setData({chatAnchor:''},()=>this.setData({chatAnchor:'service-bottom'}));}}catch(e){if(this._active)this.setData({error:e.message});}finally{this._detailLoading=false;}},back(){this._detailVersion=(this._detailVersion||0)+1;this.setData({detail:null,reply:'',keyboardHeight:0});this.load();},
 async action(e){if(this.data.busy)return;const action=e.currentTarget.dataset.action;this.setData({busy:true});try{await request('POST',this.base()+'/'+this.data.detail.id,{action,content:this.data.reply});this.setData({reply:''});await this.openId(this.data.detail.id);}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 preview(e){require('../../utils/community').previewEvidence(e.currentTarget.dataset.id,this.data.admin,true);},faq(e){const f=this.data.faq.find(x=>x.id===e.currentTarget.dataset.id);if(f)wx.showModal({title:f.title,content:f.content,showCancel:false});}
}});
