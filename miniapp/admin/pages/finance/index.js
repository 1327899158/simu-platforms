const {request}=require('../../../utils/request');
const {loadAdmin,hasPermission,denyAndExit}=require('../../utils/admin');
const {LABELS,yuan}=require('../../../utils/demo-wallet');
const {timeShort}=require('../../../utils/format');
const amount=n=>'¥'+yuan(n);
Page({
 data:{range:'month',ranges:[{key:'today',label:'今日'},{key:'week',label:'本周'},{key:'month',label:'本月'},{key:'custom',label:'自定义'}],start:'',end:'',loading:true,error:'',metrics:[],queue:[],invoices:[],detail:null,actions:[],note:'',busy:false},
 onLoad(q){this._id=q.id || '';},
 onShow(){this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 async load(){
  if(this._loading)return;this._loading=true;this.setData({loading:true,error:''});
  try{
   const admin=await loadAdmin(),permission=this._id?'WALLET_MANAGE':'FINANCE_READ';
   if(!hasPermission(admin,permission)){denyAndExit('没有访问财务功能的权限');return;}
   this.setData({canWallet:hasPermission(admin,'WALLET_MANAGE'),canInvoice:hasPermission(admin,'INVOICE_READ')});
   if(this._id){
    const d=await request('GET','/admin/finance/withdrawals/'+this._id);
    const next={SUBMITTED:[['REJECTED','拒绝提现'],['APPROVED','通过复核']],APPROVED:[['REJECTED','拒绝提现'],['PAYING','开始模拟放款']],PAYING:[['FAILED','标记失败并解冻'],['PAID_SIMULATED','确认模拟完成']]};
    this.setData({detail:{...d.item,amount:amount(d.item.amountFen),statusText:LABELS[d.item.status],createdText:timeShort(d.item.createdAt)},fee:amount(d.feeFen),net:amount(d.netFen),events:d.events.map(i=>({...i,label:LABELS[i.status] || i.status,time:timeShort(i.createdAt)})),actions:(next[d.item.status] || []).map(([status,title])=>({status,title,danger:['REJECTED','FAILED'].includes(status)}))});
    wx.setNavigationBarTitle({title:'提现复核详情'});return;
   }
   const q={range:this.data.range};if(q.range==='custom'){q.start=this.data.start;q.end=this.data.end;}
   const d=await request('GET','/admin/finance/overview',q);this._report=d;
   this.setData({start:d.dates.start,end:d.dates.end,notice:d.notice,smallCount:d.withdrawals.smallCount || 0,largeCount:d.withdrawals.largeCount || 0,
    metrics:[{label:'平台收入（抽佣＋服务费）',value:'未接入',note:'没有实际结算账本',tone:'blue'},{label:'待结算金额',value:'未接入',note:'待履约订单总额 '+amount(d.pending.amountFen),tone:'amber'},{label:'待提现金额（模拟）',value:amount(d.withdrawals.amountFen),note:'当前全部处理中申请',tone:'red'},{label:'所选期间已开发票',value:amount(d.issued.amountFen),note:d.issued.count+' 份 · 按关联订单金额',tone:'green'}],
    queue:d.queue.map(i=>({...i,amount:amount(i.amountFen),time:timeShort(i.createdAt),statusText:LABELS[i.status]})),invoices:d.invoices.map(i=>({...i,amount:amount(i.finalAmountFen)})),promotionBasis:d.promotionBasis,promotions:(d.promotions || []).map(i=>({...i,unit:amount(i.unitFen),estimated:amount(i.estimatedFen)})),paid:amount(d.paid.amountFen),daily:d.daily.map(i=>({...i,amount:amount(i.amountFen)}))});
  }catch(e){this.setData({error:e.message || '加载失败'});}finally{this._loading=false;this.setData({loading:false});}
 },
 retry(){this.load();},
 chooseRange(e){if(this._loading)return;const range=e.currentTarget.dataset.range;this.setData({range});if(range!=='custom')this.load();},
 date(e){this.setData({[e.currentTarget.dataset.key]:e.detail.value});},
 apply(){this.load();},
 withdrawal(e){wx.navigateTo({url:'/admin/pages/finance/index?id='+e.currentTarget.dataset.id});},
 invoice(e){wx.navigateTo({url:'/admin/pages/invoices/index?id='+e.currentTarget.dataset.id});},
 wallet(){wx.navigateTo({url:'/admin/pages/wallet/index'});},
 allInvoices(){wx.navigateTo({url:'/admin/pages/invoices/index'});},
 inputNote(e){this.setData({note:e.detail.value});},
 async process(e){
  if(this.data.busy)return;const note=this.data.note.trim();if(note.length<2)return wx.showToast({title:'请填写处理原因（至少2字）',icon:'none'});
  const status=e.currentTarget.dataset.status;
  const r=await new Promise(resolve=>wx.showModal({title:'确认'+(LABELS[status] || status),content:'仅更新模拟钱包，未调用银行或微信支付。处理说明：'+note,success:resolve,fail:()=>resolve({confirm:false})}));
  if(!r.confirm)return;this.setData({busy:true});
  try{await request('POST','/admin/finance/withdrawals/'+this._id,{status,note});this.setData({note:''});await this.load();wx.showToast({title:'处理完成'});}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}
 },
 async exportReport(){
  if(this.data.loading||this.data.error||!this._report)return;
  if(!wx.shareFileMessage)return wx.showModal({title:'当前微信不支持文件导出',content:'请更新微信后重试。',showCancel:false});
  const d=this._report,rows=[['财务对账汇总',d.dates.start,d.dates.end],['口径',d.notice],['平台收入','未接入'],['待结算金额','未接入'],['待履约订单总额（元）',yuan(d.pending.amountFen)],['模拟待提现金额（元）',yuan(d.withdrawals.amountFen)],['已开发票关联订单金额（元）',yuan(d.issued.amountFen)],['成功支付记录金额（元）',yuan(d.paid.amountFen)],[],['推广服务统计口径',d.promotionBasis],['收入来源','标价（元/次）','选择次数','标价测算金额（元）','实际收款'],...(d.promotions || []).map(i=>[i.label,yuan(i.unitFen),i.count,yuan(i.estimatedFen),'未接入收款']),[],['日期（北京时间）','成功支付笔数','支付金额（元）'],...d.daily.map(i=>[i.day,i.count,yuan(i.amountFen)])];
  const csv='\uFEFF'+rows.map(r=>r.map(v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');
  const filePath=wx.env.USER_DATA_PATH+'/finance-report.csv';
  try{await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:csv,encoding:'utf8',success:resolve,fail:reject}));await new Promise((resolve,reject)=>wx.shareFileMessage({filePath,fileName:'财务对账-'+d.dates.start+'至'+d.dates.end+'.csv',success:resolve,fail:reject}));}catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:'报表导出失败，请重试',icon:'none'});}
 }
});
