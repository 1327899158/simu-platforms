const {request}=require('../../utils/request');
const {countdown,display}=require('../../utils/delivery-clock');
Component({
 properties:{orderId:String,status:String,role:String},
 data:{state:null,clock:'',error:'',days:'',reason:'',busy:false,form:false},
 observers:{'orderId,status'(){if(this._active)this.refresh();}},
 lifetimes:{attached(){this.start();},detached(){this.stop();}},
 pageLifetimes:{show(){this.start();},hide(){this.stop();}},
 methods:{
  start(){if(this._active)return;this._active=true;this.refresh();this._tick=setInterval(()=>this.tick(),1000);this._poll=setInterval(()=>this.refresh(),60000);},
  stop(){this._active=false;this._version=(this._version||0)+1;clearInterval(this._tick);clearInterval(this._poll);},
  tick(){if(this.data.state?.acceptanceDeadline){const deadline=this.data.state.acceptanceDeadline;const now=Date.now()+(this._offset||0);this.setData({acceptanceClock:new Date(deadline).getTime()<=now?'已到期，等待系统确认':countdown(deadline,now)});}if(!this.data.state||!this.data.state.deadline)return;const now=Date.now()+(this._offset||0),clock=countdown(this.data.state.deadline,now),overdueVisible=this.data.state.orderStatus==='IN_PROGRESS'&&now>new Date(this.data.state.deadline).getTime();if(clock!==this.data.clock||overdueVisible!==this.data.overdueVisible)this.setData({clock,overdueVisible});},
  async refresh(){if(!this.data.orderId)return;const version=this._version=(this._version||0)+1;try{const state=await request('GET',`/orders/${this.data.orderId}/delivery`,null,{silent:true});if(!this._active||version!==this._version)return;this._offset=new Date(state.serverNow).getTime()-Date.now();state.deadlineText=display(state.deadline);state.acceptanceDeadlineText=display(state.acceptanceDeadline);state.items=state.items.map(x=>({...x,statusText:({PENDING:'待客户审批',APPROVED:'已同意',REJECTED:'未同意'})[x.status],proposedText:display(x.proposedDeadline)}));state.pending=state.items.some(x=>x.status==='PENDING');state.extensionText=state.pending?'延期申请待客户审批':state.items.length&&state.items[0].status==='REJECTED'?'延期申请未获同意，原期限不变':'尚无待审批延期申请';this.setData({state,error:''});this.tick();if(state.orderStatus&&state.orderStatus!==this.data.status)this.triggerEvent('statuschange');}catch(e){if(this._active&&version===this._version)this.setData({state:null,error:e.statusCode===403?'':e.message||'期限加载失败'});}},
  async nudge(){if(this.data.busy)return;this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/delivery/nudge`,{});await this.refresh();wx.showToast({title:'催单已发送'});}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
  aftersales(){this.triggerEvent('aftersales');},
  refundRecord(){const id=this.data.state?.overdue?.breach?.disputeId;if(id)wx.navigateTo({url:'/pages/dispute-detail/index?id='+id});},
  toggle(){this.setData({form:!this.data.form});},input(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},
  async apply(){if(this.data.busy)return;const days=Number(this.data.days);if(!Number.isInteger(days)||days<1||days>90)return wx.showToast({title:'请输入1至90天',icon:'none'});if(this.data.reason.trim().length<2)return wx.showToast({title:'请填写延期原因',icon:'none'});this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/delivery/apply`,{days,reason:this.data.reason});this.setData({form:false,days:'',reason:''});await this.refresh();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
  async respond(e){if(this.data.busy)return;const {id,decision}=e.currentTarget.dataset;const agreed=await require('../../utils/community').confirm(decision==='APPROVED'?'同意延期？':'不同意延期？',decision==='APPROVED'?'同意后将按申请天数延长原截止时间。':'不同意将保留原交付截止时间。');if(!agreed)return;this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/delivery/respond`,{id,decision});await this.refresh();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}}
 }
});
