const {request}=require('../../utils/request');
Component({properties:{orderId:String,orderStatus:String},data:{info:null,units:1,busy:false,error:'',ready:false},
 lifetimes:{attached(){this.start();},detached(){this.stop();}},pageLifetimes:{show(){this.start();},hide(){this.stop();}},methods:{
 start(){if(this._active)return;this._active=true;this.load();this._timer=setInterval(()=>this.load(),10000);},
 stop(){this._active=false;clearInterval(this._timer);},
 async load(){if(!this.data.orderId||this._loading)return;this._loading=true;try{
  const info=await request('GET',`/orders/${this.data.orderId}/exposure`,null,{silent:true});
  if(this._active)this.setData({info,units:info?info.targetPeople/100:this.data.units,ready:true,error:''});
 }catch(e){if(this._active)this.setData({error:e.message||'曝光进度读取失败'});}finally{this._loading=false;}},
 quantity(e){this.setData({units:Math.max(1,Math.min(100,Math.floor(Number(e.detail.value)||1)))});},
 async pay(){if(this.data.busy)return;this.setData({busy:true});try{
  const amount=(this.data.info?this.data.info.amountFen/100:this.data.units*19).toFixed(2);
  const confirmed=await new Promise(resolve=>wx.showModal({title:'购买需求曝光',content:`推流给${this.data.units*100}位不同工程师，费用¥${amount}。需求停止报价后暂停推流，未完成部分可联系订单客服处理。`,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
  if(!confirmed)return;
  const p=await request('POST',`/orders/${this.data.orderId}/exposure/pay`,{units:this.data.units});
  if(!p.alreadyPaid){
   if(p.mode==='mock'){
    const answer=await new Promise(resolve=>wx.showModal({title:'模拟曝光支付',content:`模拟金额¥${(p.amountFen/100).toFixed(2)}，不会实际扣款。`,success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
    if(!answer)return;
    await request('POST',`/orders/${this.data.orderId}/exposure/mock-confirm`,{});
   }else await new Promise((resolve,reject)=>wx.requestPayment({timeStamp:p.timeStamp,nonceStr:p.nonceStr,package:p.package,signType:p.signType,paySign:p.paySign,success:resolve,fail:reject}));
  }
  await this.load();
  wx.showToast({title:this.data.info && this.data.info.state!=='UNPAID'?'曝光已开通':'支付结果待确认，请刷新进度',icon:'none'});
 }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'支付未完成，请查询进度',icon:'none'});}finally{this.setData({busy:false});}},
 help(){wx.navigateTo({url:'/pages/customer-service/index?orderId='+encodeURIComponent(this.data.orderId)});}
}});
