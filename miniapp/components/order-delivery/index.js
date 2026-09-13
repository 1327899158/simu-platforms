const {request}=require('../../utils/request');
const {countdown,display}=require('../../utils/delivery-clock');
Component({
 properties:{orderId:String,status:String},
 data:{state:null,clock:'',error:'',days:'',reason:'',busy:false,form:false},
 observers:{'orderId,status'(){if(this._active)this.refresh();}},
 lifetimes:{attached(){this.start();},detached(){this.stop();}},
 pageLifetimes:{show(){this.start();},hide(){this.stop();}},
 methods:{
  start(){if(this._active)return;this._active=true;this.refresh();this._tick=setInterval(()=>this.tick(),1000);this._poll=setInterval(()=>this.refresh(),60000);},
  stop(){this._active=false;this._version=(this._version||0)+1;clearInterval(this._tick);clearInterval(this._poll);},
  tick(){if(!this.data.state||!this.data.state.deadline)return;const clock=countdown(this.data.state.deadline,Date.now()+(this._offset||0));if(clock!==this.data.clock)this.setData({clock});},
  async refresh(){if(!this.data.orderId)return;const version=this._version=(this._version||0)+1;try{const state=await request('GET',`/orders/${this.data.orderId}/delivery`,null,{silent:true});if(!this._active||version!==this._version)return;this._offset=new Date(state.serverNow).getTime()-Date.now();state.deadlineText=display(state.deadline);state.items=state.items.map(x=>({...x,statusText:({PENDING:'待客户审批',APPROVED:'已同意',REJECTED:'未同意'})[x.status],proposedText:display(x.proposedDeadline)}));state.pending=state.items.some(x=>x.status==='PENDING');this.setData({state,error:''});this.tick();}catch(e){if(this._active&&version===this._version)this.setData({state:null,error:e.statusCode===403?'':e.message||'期限加载失败'});}},
  toggle(){this.setData({form:!this.data.form});},input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},
  async apply(){if(this.data.busy)return;const days=Number(this.data.days);if(!Number.isInteger(days)||days<1||days>90)return wx.showToast({title:'请输入1至90天',icon:'none'});if(this.data.reason.trim().length<2)return wx.showToast({title:'请填写延期原因',icon:'none'});this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/delivery/apply`,{days,reason:this.data.reason});this.setData({form:false,days:'',reason:''});await this.refresh();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
  async respond(e){if(this.data.busy)return;const {id,decision}=e.currentTarget.dataset;const agreed=await require('../../utils/community').confirm(decision==='APPROVED'?'同意延期？':'不同意延期？',decision==='APPROVED'?'同意后将按申请天数延长原截止时间。':'不同意将保留原交付截止时间。');if(!agreed)return;this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/delivery/respond`,{id,decision});await this.refresh();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}}
 }
});
