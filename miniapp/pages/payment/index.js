const {request}=require('../../utils/request');
const {ensureLogin}=require('../../utils/auth');
const {fenToYuan}=require('../../utils/format');
Page({
 data:{id:'',order:null,amountFen:null,amountText:'—',loading:false,busy:false,success:false,error:''},
 onLoad(q){this.setData({id:q.id||''});},
 onShow(){const u=ensureLogin();if(!u)return;if(u.role!=='CUSTOMER'){this.setData({error:'仅订单客户可以支付'});return;}this.load();},
 async load(){if(this.data.loading)return;this.setData({loading:true,error:''});try{
  if(!this.data.id)throw Error('缺少订单编号');
  const o=await request('GET','/orders/'+this.data.id);
  const s=await request('GET','/orders/'+this.data.id+'/payment');
  const amount=s.payment?Number(s.payment.amountFen):Number(o.finalAmountFen);
  if(!Number.isSafeInteger(amount)||amount<=0)throw Error('支付金额尚未确认，请返回订单详情');
  const success=!!(s.payment&&s.payment.status==='SUCCESS');
  if(!success&&o.status!=='AWAITING_PAYMENT')throw Error('订单当前不可支付，请返回查看最新状态');
  this.setData({order:o,amountFen:amount,amountText:fenToYuan(amount),success});
 }catch(e){this.setData({error:e.message||'订单加载失败'});}finally{this.setData({loading:false});}},
 async confirmPay(){if(this.data.busy||this.data.loading||this.data.error||this.data.success||!this.data.order)return;
  this.setData({busy:true});try{
   const answer=await new Promise(resolve=>wx.showModal({title:'确认模拟支付',content:'本次模拟金额 ¥'+this.data.amountText+'，不会扣款。确认后订单将进入执行中。',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
   if(!answer)return;
   const p=await request('POST','/orders/'+this.data.id+'/pay',{});
   if(p.mode!=='mock')throw Error('当前环境不是模拟支付模式，请返回订单详情使用正式支付入口');
   if(Number(p.amountFen)!==this.data.amountFen){await this.load();throw Error('金额发生变化，请核对后重新确认');}
   await request('POST','/orders/'+this.data.id+'/pay/mock-confirm',{});
   await this.load();
   if(!this.data.success)throw Error('支付结果待确认，请刷新查询，不要重复提交');
  }catch(e){this.setData({error:e.message||'模拟支付失败，请刷新重试'});}finally{this.setData({busy:false});}
 },
 back(){wx.navigateBack({fail:()=>wx.redirectTo({url:'/pages/order-detail/index?id='+encodeURIComponent(this.data.id)+'&mode=customer'})});}
});
