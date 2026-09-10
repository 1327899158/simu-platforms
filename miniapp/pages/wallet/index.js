const {request}=require('../../utils/request'),{ensureLogin}=require('../../utils/auth');
const {LABELS,yuan,businessKey,fen}=require('../../utils/demo-wallet');
Page({
 data:{info:null,busy:false,error:'',tab:'withdrawals',amount:'',items:[],userId:''},
 onShow(){const u=ensureLogin();if(!u)return;if(u.role!=='ENGINEER')return wx.navigateBack();this.setData({userId:u.id});this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 retry(){this.load();},more(){if(this.data.info?.nextOffset!==null)this.load(true);},
 async load(more=false){if(this._loading)return;this._loading=true;try{const info=await request('GET','/wallet',{offset:more?this.data.info.nextOffset:0});info.available=yuan(info.availableFen);info.frozen=yuan(info.frozenFen);
 info.withdrawals=info.withdrawals.map(r=>({...r,amount:yuan(r.amountFen),label:LABELS[r.status]}));
 info.ledger=info.ledger.map(r=>({...r,change:yuan(r.deltaAvailable),frozenChange:yuan(r.deltaFrozen),balance:yuan(r.availableAfter)}));
 info.holds=info.holds.map(r=>({...r,amount:yuan(r.amountFen),label:r.status==='HELD'?'冻结中':r.status==='RELEASED'?'已解冻':'已用于模拟打款'}));
 if(more)for(const k of ['withdrawals','ledger','holds'])info[k]=this.data.info[k].concat(info[k]);
 this.setData({info,error:''});}catch(e){this.setData({error:e.message});}finally{this._loading=false;}},
 tab(e){this.setData({tab:e.currentTarget.dataset.tab});},
 input(e){this.setData({amount:e.detail.value});},all(){this.setData({amount:this.data.info.available});},
 bank(){wx.navigateTo({url:'/pages/bank-card/index'});},
 async withdraw(){if(this.data.busy)return;let amountFen;try{amountFen=fen(this.data.amount);}catch(e){return wx.showToast({title:e.message,icon:'none'});}
 const c=this.data.info?.cards[0];if(!c)return this.bank();
 if(!await require('../../utils/community').confirm('模拟提现','仅测试冻结、审核和打款状态，不产生真实资金转账。'))return;
 this._request=this._request||{amountFen,cardId:c.id,businessKey:businessKey()};
 if(this._request.amountFen!==amountFen||this._request.cardId!==c.id)return wx.showToast({title:'请先重试原申请并确认结果',icon:'none'});
 this.setData({busy:true});
 try{await request('POST','/wallet/withdraw',this._request);this._request=null;this.setData({amount:''});await this.load();wx.showToast({title:'模拟申请已提交'});}
 catch(e){if(e.statusCode>=400&&e.statusCode<500)this._request=null;wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 async cancel(e){if(this.data.busy)return;if(!await require('../../utils/community').confirm('撤销模拟提现','撤销后冻结金额将退回模拟余额。'))return;this.setData({busy:true});try{await request('POST','/wallet/withdrawals/'+e.currentTarget.dataset.id+'/cancel');await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}}
});
