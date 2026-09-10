const {ensureLogin}=require('../../utils/auth');
const {request}=require('../../utils/request');
const {fenToYuan}=require('../../utils/format');
const labels={COMPLETED:'已完成',IN_PROGRESS:'履约中',DELIVERED:'待验收',REFUND_PENDING:'退款中',DISPUTING:'纠纷中'};
Page({
 data:{loading:false,error:'',info:null,items:[],nextOffset:null},
 onShow(){const user=ensureLogin();if(!user)return;if(user.role!=='ENGINEER'){wx.navigateBack();return;}this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 onReachBottom(){this.more();},
 retry(){this.load();},
 more(){if(this.data.nextOffset!==null)this.load(true);},
 async load(more=false){
  if(this.data.loading)return;this.setData({loading:true,error:''});
  try{
   const info=await request('GET','/engineers/earnings',{offset:more?this.data.nextOffset:0});
   const max=Math.max(1,...info.trend.map(x=>x.amountFen));
   info.trend=info.trend.map(x=>({...x,amount:fenToYuan(x.amountFen),width:Math.round(x.amountFen/max*100)}));
   const summary=info.summary;info.amounts={completed:fenToYuan(summary.completedFen),month:fenToYuan(summary.monthFen),active:fenToYuan(summary.activeFen),held:fenToYuan(summary.heldFen)};
   const items=info.items.map(x=>({...x,amount:fenToYuan(x.finalAmountFen),label:labels[x.status]||x.status}));
   this.setData({info,items:more?this.data.items.concat(items):items,nextOffset:info.nextOffset});
  }catch(e){this.setData({error:e.message||'收益数据加载失败'});}
  finally{this.setData({loading:false});}
 },
 open(e){wx.navigateTo({url:'/pages/order-detail/index?id='+encodeURIComponent(e.currentTarget.dataset.id)+'&mode=market'});}
});
