const {request}=require('../../utils/request');
const {ensureLogin}=require('../../utils/auth');
const {fenToYuan}=require('../../utils/format');
Page({
 data:{id:'',order:null,amountFen:null,amountText:'—',grossAmountFen:0,grossText:'—',coins:0,locked:false,mode:'mock',loading:false,busy:false,success:false,error:''},
 onLoad(q){this.setData({id:q.id||''});},
 onShow(){const u=ensureLogin();if(!u)return;if(u.role!=='CUSTOMER'){this.setData({error:'仅订单客户可以支付'});return;}this.load();},
 async load(){if(this.data.loading)return;this.setData({loading:true,error:''});try{
  if(!this.data.id)throw Error('缺少订单编号');
  const o=await request('GET','/orders/'+this.data.id),s=await request('GET','/orders/'+this.data.id+'/payment');
  const p=s.payment&&s.payment.status!=='FAILED'?s.payment:null;
  const gross=Number(p?.grossAmountFen??p?.amountFen??o.finalAmountFen),coins=Number(p?p.coinAmount||0:this.data.coins||0),cash=Number(p?.amountFen??gross-coins);
  if(!Number.isSafeInteger(gross)||gross<=0||!Number.isSafeInteger(cash)||cash<0)throw Error('支付金额尚未确认，请返回订单详情');
  const success=!!(p&&p.status==='SUCCESS');
  if(!success&&o.status!=='AWAITING_PAYMENT')throw Error('订单当前不可支付，请返回查看最新状态');
  this.setData({order:o,mode:s.mode||'mock',grossAmountFen:gross,grossText:fenToYuan(gross),amountFen:cash,amountText:fenToYuan(cash),coins,locked:!!p,success});
 }catch(e){this.setData({error:e.message||'订单加载失败'});}finally{this.setData({loading:false});}},
 coinChange(e){if(this.data.locked||this.data.busy)return;const coins=Number(e.detail.coins||0);this.setData({coins,amountFen:this.data.grossAmountFen-coins,amountText:fenToYuan(this.data.grossAmountFen-coins)});},
 async cancelPending(){if(this.data.busy)return;this.setData({busy:true});try{const result=await request('POST','/orders/'+this.data.id+'/pay/cancel',{});await this.load();if(result.cancelled&&!this.data.locked&&!this.data.success){this.setData({coins:0,amountFen:this.data.grossAmountFen,amountText:this.data.grossText});const selector=this.selectComponent?.('#payment-coins');selector?.reset();selector?.load();}}catch(e){this.setData({error:e.message||'取消失败，请稍后重试'});}finally{this.setData({busy:false});}},
 async confirmPay(){if(this.data.busy||this.data.loading||this.data.error||this.data.success||!this.data.order)return;
  this.setData({busy:true});try{
   const coins=this.data.coins,cash=this.data.amountFen;
   const answer=await new Promise(resolve=>wx.showModal({title:this.data.mode==='mock'?'确认模拟支付':'确认支付',content:`使用${coins}仿真币抵扣，现金应付¥${this.data.amountText}。`+(this.data.mode==='mock'?'现金部分不会实际扣款，仿真币抵扣会记录到账户。':''),success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
   if(!answer)return;
   const p=await request('POST','/orders/'+this.data.id+'/pay',{coins});
   if(Number(p.amountFen)!==cash||Number(p.coinAmount||0)!==coins){await this.load();throw Error('金额发生变化，请核对后重新确认');}
   if(p.mode==='mock')await request('POST','/orders/'+this.data.id+'/pay/mock-confirm',{});
   else if(p.mode==='wechat')await new Promise((resolve,reject)=>wx.requestPayment({timeStamp:p.timeStamp,nonceStr:p.nonceStr,package:p.package,signType:p.signType,paySign:p.paySign,success:resolve,fail:reject}));
   else if(p.mode!=='coins')throw Error('支付方式不可用，请刷新');
   await this.load();
   for(let i=0;p.mode==='wechat'&&!this.data.success&&i<3;i++){await new Promise(resolve=>setTimeout(resolve,1000));await this.load();}
   if(!this.data.success)throw Error('支付结果待确认，请刷新查询，不要重复提交');
  }catch(e){
   if(String(e.errMsg||'').includes('cancel')){
    try{await request('POST','/orders/'+this.data.id+'/pay/cancel',{});await this.load();}catch(_){this.setData({error:'取消支付待确认，请先查询状态，再取消支付单释放仿真币'});}
   }else this.setData({error:e.message||'支付失败，请刷新重试'});
  }finally{this.setData({busy:false});}
 },
 back(){wx.navigateBack({fail:()=>wx.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(this.data.id)+'&mode=customer'})});}
});
