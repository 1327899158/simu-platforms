const {request}=require('../../utils/request'),{ensureLogin}=require('../../utils/auth');
const {yuan}=require('../../utils/demo-wallet'),{timeShort}=require('../../utils/format');
const names={ORDER_COMPLETE:'完成订单奖励',SIGNIN:'每日签到',ACTIVITY:'活动奖励',FIRST:'完成首单',TEN:'十单成就',WEEK_THREE:'本周完成3单',STREAK_THREE:'连续交付',ORDER_DEDUCT:'订单支付抵扣',EXPOSURE_DEDUCT:'购买曝光抵扣',COIN_REFUND:'抵扣仿真币退回',INVITE_REGISTER:'邀请好友注册',INVITE_FIRST_ORDER:'邀请好友完成首单'};
Page({
 data:{info:null,busy:false,error:'',tab:'coins',user:null},
 onShow(){const user=ensureLogin();if(!user)return;this.setData({user});this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},retry(){this.load();},
 more(){if(this.data.info&&this.data.info.nextOffset!==null)this.load(true);},
 async load(more=false){if(this._loading)return;this._loading=true;try{
  const info=await request('GET','/benefits',{offset:more?this.data.info.nextOffset:0});
  info.deductible=yuan(info.balance);info.coupons=info.coupons.map(x=>({...x,amount:yuan(x.amountFen),min:yuan(x.minSpendFen),expiresText:timeShort(x.expiresAt)}));
  info.coins=info.coins.map(x=>({...x,label:names[x.taskKey]||'任务奖励',amountText:(Number(x.amount)>0?'+':'')+x.amount,time:timeShort(x.createdAt),income:Number(x.amount)>0}));
  info.offers=info.offers.map(x=>({...x,amountText:x.kind==='COUPON'?'¥'+yuan(x.amount):x.amount+' 币'}));
  if(more){info.coupons=this.data.info.coupons.concat(info.coupons);info.coins=this.data.info.coins.concat(info.coins);}
  this.setData({info,error:''});
 }catch(e){this.setData({error:e.message});}finally{this._loading=false;}},
 tab(e){this.setData({tab:e.currentTarget.dataset.tab});},signin(){wx.navigateTo({url:'/pages/incentives/index'});},
 invite(){wx.navigateTo({url:'/pages/invite-poster/index'});},
 use(){if(this.data.user.role!=='CUSTOMER')return wx.showToast({title:'切换至客户身份后可支付订单或购买需求曝光',icon:'none'});wx.navigateTo({url:'/pages/orders/index'});},
 async claim(e){if(this.data.busy)return;this.setData({busy:true});try{const r=await request('POST','/benefits/claim',{key:e.currentTarget.dataset.key});wx.showToast({title:r.duplicate?'已领取，请勿重复':'已领取'});await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}}
});
