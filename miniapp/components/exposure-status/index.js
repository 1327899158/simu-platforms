const {request}=require('../../utils/request');
Component({properties:{orderId:String,orderStatus:String},data:{info:null,units:1,coins:0,busy:false,error:'',ready:false},
 lifetimes:{attached(){this.start();},detached(){this.stop();}},pageLifetimes:{show(){this.start();},hide(){this.stop();}},methods:{
 start(){if(this._active)return;this._active=true;this.load();this._timer=setInterval(()=>this.load(),10000);},
 stop(){this._active=false;clearInterval(this._timer);},
 async load(){if(!this.data.orderId||this._loading)return;this._loading=true;try{
  const info=await request('GET',`/orders/${this.data.orderId}/exposure`,null,{silent:true});
  if(this._active)this.setData({info,units:info&&(!this._quantityEdited||info.paymentStarted||info.state!=='UNPAID')?info.targetPeople/100:this.data.units,coins:info?.paymentStarted?Number(info.coinAmount||0):this.data.coins,ready:true,error:''});
 }catch(e){if(this._active)this.setData({error:e.message||'曝光进度读取失败'});}finally{this._loading=false;}},
 quantity(e){this._quantityEdited=true;this.setData({units:Math.max(1,Math.min(100,Math.floor(Number(e.detail.value)||1)))});},
 coinChange(e){if(!this.data.busy)this.setData({coins:Number(e.detail.coins||0)});},
 async cancelPending(){if(this.data.busy)return;this.setData({busy:true});try{await request('POST',`/orders/${this.data.orderId}/exposure/cancel`,{});this.setData({coins:0});await this.load();this.selectComponent?.('#exposure-coins')?.load();}catch(e){wx.showToast({title:e.message||'取消失败，请重试',icon:'none'});}finally{this.setData({busy:false});}},
 async pay(){if(this.data.busy)return;this.setData({busy:true});try{
  const gross=this.data.info?.paymentStarted?this.data.info.amountFen:this.data.units*1900,coins=this.data.coins,amount=((gross-coins)/100).toFixed(2);
  const confirmed=await new Promise(resolve=>wx.showModal({title:'购买需求曝光',content:`推流给${this.data.units*100}位不同工程师，总价¥${(gross/100).toFixed(2)}，使用${coins}仿真币抵扣，现金¥${amount}。需求停止报价后暂停推流，未完成部分可联系订单客服处理。`,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!confirmed)return;
  const p=await request('POST',`/orders/${this.data.orderId}/exposure/pay`,{units:this.data.units,coins});
  if(!p.alreadyPaid){
   if(Number(p.amountFen)!==gross-coins||Number(p.coinAmount||0)!==coins)throw Error('曝光金额发生变化，请刷新后重新确认');
   if(p.mode==='mock'){
    const answer=await new Promise(resolve=>wx.showModal({title:'模拟曝光支付',content:`模拟金额¥${(p.amountFen/100).toFixed(2)}，不会实际扣款。`,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
    if(!answer){await request('POST',`/orders/${this.data.orderId}/exposure/cancel`,{});await this.load();return;}
    await request('POST',`/orders/${this.data.orderId}/exposure/mock-confirm`,{});
   }else if(p.mode==='wechat')await new Promise((resolve,reject)=>wx.requestPayment({timeStamp:p.timeStamp,nonceStr:p.nonceStr,package:p.package,signType:p.signType,paySign:p.paySign,success:resolve,fail:reject}));
   else if(p.mode!=='coins')throw Error('曝光支付方式不可用');
  }
  await this.load();
  wx.showToast({title:this.data.info && this.data.info.state!=='UNPAID'?'曝光已开通':'支付结果待确认，请刷新进度',icon:'none'});
 }catch(e){if(String(e.errMsg||'').includes('cancel')){try{await request('POST',`/orders/${this.data.orderId}/exposure/cancel`,{});await this.load();}catch(_){wx.showToast({title:'取消待确认，请在详情取消支付单释放仿真币',icon:'none'});}}else {await this.load();wx.showToast({title:e.message||'支付未完成，请查询进度',icon:'none'});}}finally{this.setData({busy:false});}},
 help(){wx.navigateTo({url:'/pages/customer-service/index?orderId='+encodeURIComponent(this.data.orderId)});}
}});
