const { request } = require('../../../utils/request');
const { loadAdmin, hasPermission, denyAndExit } = require('../../utils/admin');
const { timeShort } = require('../../../utils/format');
const META = {
  finance: ['财务中心', '支付趋势 · 退款记录 · 发票与模拟提现', 'FINANCE_READ'],
  hall: ['大厅统计', '公开需求的浏览、报价与供需概况', 'DASHBOARD_READ'],
  storage: ['存储管理', '业务登记文件的容量、分类与清单', 'STORAGE_READ'],
  config: ['平台配置', '当前规则与可调整的大厅排序', 'CONFIG_MANAGE'],
  marketing: ['营销活动', '活动管理与已发放优惠权益', 'CAMPAIGN_MANAGE'],
  appeals: ['退款申诉', '已升级为纠纷的退款申请', 'DISPUTE_READ'],
  accounts: ['账号与权限', '以已注册用户身份分配管理员权限', 'ADMIN_MANAGE'],
};
const labels = { SUCCESS:'成功', NONE:'无', PENDING:'待处理', PROCESSING:'处理中', FAILED:'失败', RESERVED:'预留权益', USED:'已使用', EXPIRED:'已过期', SUBMITTED:'待审核', APPROVED:'已通过', PAYING:'模拟打款中', PAID:'已打款', REJECTED:'已拒绝', CANCELLED:'已取消', REQUESTED:'工程师待处理', PLATFORM_REQUESTED:'平台待开票', ISSUED:'已开票', OPEN:'举证 / 仲裁中', RESOLVED:'已结案', CUSTOMER:'客户', ENGINEER:'工程师' };
const label = key => labels[key] || key;
const money = value => '¥' + (Number(value || 0)/100).toFixed(2);
const bytes = value => (Number(value || 0)/1024/1024).toFixed(2)+' MB';
const metric = (title,value) => ({title,value});
const row = (id,title,subtitle,value,path) => ({id,title,subtitle,value,path:path || ''});
const path = name => '/admin/pages/'+name+'/index';
Page({
  data: { kind:'',title:'平台管理',subtitle:'',loading:true,error:'',metrics:[],sections:[],links:[],items:[],roles:[],days:30,dayOptions:[7,30,90],offset:0,hasMore:false,form:null,saving:false,hotQuoteWeight:'3' },
  onLoad(options) {
    if(options.kind==='finance'){wx.redirectTo({url:'/admin/pages/finance/index'});return;}
    const kind=Object.prototype.hasOwnProperty.call(META,options.kind) ? options.kind : 'hall';
    this.setData({kind,title:META[kind][0],subtitle:META[kind][1]});
    wx.setNavigationBarTitle({title:META[kind][0]});
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load(append=false) {
    if(this._loading)return;
    this._loading=true; this.setData({loading:true,error:''});
    try {
      const admin=await loadAdmin();
      if(!hasPermission(admin,META[this.data.kind][2])) { denyAndExit('没有访问此功能的权限');return; }
      const offset=append ? this.data.items.length : 0;
      const result=await request('GET','/admin/console/'+this.data.kind,{days:this.data.days,offset},{silent:true});
      this._result=result;
      const items=append ? this.data.items.concat(result.items || []) : result.items || [];
      this.setData({admin,items,hasMore:!!result.hasMore,notice:result.notice || '',offset});
      this.present(result,items,admin);
    } catch(e) { if(e.statusCode===403 || e.statusCode===401)denyAndExit(e.message); else this.setData({error:e.message || '数据加载失败，请重试'}); }
    finally { this._loading=false;this.setData({loading:false}); }
  },
  present(d,items,admin) {
    let metrics=[],sections=[],links=[];
    const kind=this.data.kind;
    if(kind==='finance') {
      metrics=[metric('近'+d.days+'日成功支付记录',money(d.payments.amountFen)),metric('成功支付笔数',d.payments.count),metric('模拟钱包可用余额',money(d.wallet.availableFen)),metric('模拟钱包冻结余额',money(d.wallet.frozenFen))];
      sections=[{title:'每日成功支付 · 北京时间',rows:d.daily.map(i=>row(i.day,i.day,i.count+' 笔',money(i.amountFen)))},
        {title:'纠纷退款记录 · 全部时间',rows:d.refunds.map(i=>row(i.status,label(i.status),i.count+' 笔',money(i.amountFen)))},
        {title:'模拟提现 · 全部时间',rows:d.withdrawals.map(i=>row(i.status,label(i.status),i.count+' 笔',money(i.amountFen)))},
        {title:'发票申请 · 全部时间',rows:d.invoices.map(i=>row(i.status,label(i.status),'',i.count+' 份'))}];
      links=[['模拟提现审核','wallet','WALLET_MANAGE'],['发票申请处理','invoices','INVOICE_READ']];
    } else if(kind==='hall') {
      const a=d.analytics || {},t=a.totals || {};
      metrics=[metric('历史公开需求',t.total || 0),metric('完成订单',t.completed || 0),metric('终止未完成订单',t.terminated || 0),metric('当前待报价',d.summary.quoting || 0),metric('发生有效纠纷的订单',t.disputeOrders || 0),metric('申请过退款的订单',t.refundOrders || 0)];
      this.setData({directions:a.directions || []});
      sections=[
        {title:'终止未完成订单 · 原因分布',rows:(a.failures || []).map(i=>row(i.category,i.label,'按订单去重，每单归入一种关闭原因',i.count+' 单'))},
        {title:'纠纷类型与处理结果',rows:(a.disputes || []).map((i,n)=>row(n,i.label,i.statusText,i.count+' 次申请 · '+i.orders+' 单'))},
        {title:'退款类型与处理结果',rows:(a.refunds || []).map((i,n)=>row(n,i.category,i.statusText,i.count+' 次申请 · '+i.orders+' 单'))},
        {title:'浏览热度 TOP 20 · 待报价需求',rows:d.top.map(i=>row(i.id,i.projectName,i.orderNo+' · 浏览 '+i.viewCount+' · 报价 '+i.quoteCount,i.budgetFen == null?'面议':money(i.budgetFen),hasPermission(admin,'ORDER_READ')?path('order-detail')+'?id='+i.id:''))},
        {title:'有效用户供需概况',rows:d.users.map(i=>row(i.role,label(i.role),'有效账号',i.count))}];
      this.setData({notice:'全历史公开需求，排除定向订单，包含已关闭/删除的历史记录。终止未完成指已取消或已关闭，不把进行中订单或单纯发起纠纷当作失败。关闭原因按仲裁、同意退款、管理员关闭、其他依次归类。纠纷/退款次数可重复，分类涉及订单数不可相加；退款同意不等于真实资金已退回。旧退款无法识别的类型归为“历史未分类”。'});
    } else if(kind==='storage') {
      metrics=[metric('已登记文件 / 链接',d.summary.count),metric('登记文件容量',bytes(d.summary.bytes)),metric('网盘链接',d.summary.links || 0)];
      sections=[{title:'按资料类型统计',rows:d.groups.map(i=>row(i.kind,i.kind,i.count+' 项',bytes(i.bytes)))},
        {title:'文件登记清单（最新优先）',rows:items.map(i=>row(i.id,i.name,timeShort(i.createdAt)+' · '+i.kind,i.isLink?'外部链接':bytes(i.sizeBytes)))}];
    } else if(kind==='marketing') {
      sections=[{title:'优惠权益领取统计',rows:d.coupons.map((i,n)=>row(n,i.title,label(i.status)+' · '+i.count+' 份',money(i.amountFen)))}];
      links=[['首页活动与轮播','campaigns','CAMPAIGN_MANAGE'],['公告管理','announcements','ANNOUNCEMENT_MANAGE']];
    } else if(kind==='appeals') {
      sections=[{title:'退款申诉记录',rows:items.map(i=>row(i.id,i.projectName || '订单',i.orderNo+' · '+i.reason,label(i.disputeStatus || i.status),i.disputeStatus?path('dispute-detail')+'?id='+i.disputeId:''))}];
    } else if(kind==='config') {
      this.setData({hotQuoteWeight:String(d.settings.hotQuoteWeight)});
      metrics=[metric('当前支付模式',d.paymentMode==='mock'?'模拟支付':d.paymentMode),metric('上传上限',d.uploadMaxMb+' MB')];
      sections=[{title:'当前工程师等级规则（只读）',rows:d.levels.map(i=>row(i.key,i.name,i.rule,i.rate == null?'':i.rate+'% 参考费率'))}];
    } else if(kind==='accounts') {
      this.setData({roles:d.roles,accounts:items.map(i=>({...i,roleText:d.roles.find(r=>r.key===i.adminRole)?.label || i.adminRole,statusText:i.status==='ACTIVE'?'启用':'停用',lastLoginText:i.lastLoginAt?timeShort(i.lastLoginAt):'尚未登录'})),notice:'先在用户管理中复制已注册用户ID，再授予权限。新授权不创建密码、不发送短信；对方使用原账号登录。权限更改会记录审计日志，自己的权限及部署配置账号受保护。'});
      links=[['查找已注册用户','users','USER_READ'],['查看操作日志','audit-logs','AUDIT_READ']];
    }
    this.setData({metrics,sections,links:links.filter(i=>hasPermission(admin,i[2])).map(i=>({title:i[0],path:path(i[1])}))});
  },
  more() { this.load(true); },
  retry() { this.load(); },
  range(e) { if(this._loading)return;this.setData({days:Number(e.currentTarget.dataset.days)});this.load(); },
  open(e) { const url=e.currentTarget.dataset.path;if(url)wx.navigateTo({url}); },
  home() { wx.redirectTo({url:path('dashboard')}); },
  inputWeight(e) { this.setData({hotQuoteWeight:e.detail.value}); },
  async saveConfig() {
    const n=Number(this.data.hotQuoteWeight);
    if(!/^\d+$/.test(this.data.hotQuoteWeight) || !Number.isInteger(n) || n<0 || n>20) {wx.showToast({title:'请输入 0–20 的整数',icon:'none'});return;}
    if(this.data.saving)return;this.setData({saving:true});
    try {await request('PATCH','/admin/console/config',{hotQuoteWeight:n});wx.showToast({title:'配置已生效'});}catch(e){wx.showToast({title:e.message || '保存失败',icon:'none'});}finally{this.setData({saving:false});}
  },
  newAccount() { this.setData({form:{userId:'',displayName:'',roleIndex:1,status:'ACTIVE'},editing:false}); },
  editAccount(e) { const a=this.data.accounts.find(i=>i.id===e.currentTarget.dataset.id);if(a)this.setData({form:{userId:a.userId,displayName:a.displayName || '',roleIndex:Math.max(0,this.data.roles.findIndex(r=>r.key===a.adminRole)),status:a.status},editing:true}); },
  cancelForm() { if(!this.data.saving)this.setData({form:null}); },
  inputForm(e) { const key=e.currentTarget.dataset.key;if(['userId','displayName'].includes(key))this.setData({['form.'+key]:e.detail.value}); },
  pickRole(e) { this.setData({'form.roleIndex':Number(e.detail.value)}); },
  toggleStatus(e) { this.setData({'form.status':e.detail.value?'ACTIVE':'DISABLED'}); },
  async saveAccount() {
    if(this.data.saving)return;
    const form=this.data.form,role=this.data.roles[form.roleIndex];
    if(!form.userId.trim() || !form.displayName.trim()){wx.showToast({title:'请填写用户ID和名称',icon:'none'});return;}
    const result=await new Promise(resolve=>wx.showModal({title:'确认管理员授权',content:form.displayName+'：'+role.label+'，'+(form.status==='ACTIVE'?'启用':'停用')+'。保存后权限立即生效。',success:resolve,fail:()=>resolve({confirm:false})}));
    if(!result.confirm)return;
    this.setData({saving:true});
    try {await request('POST','/admin/console/accounts',{userId:form.userId.trim(),displayName:form.displayName.trim(),adminRole:role.key,status:form.status});this.setData({form:null});await this.load();wx.showToast({title:'已保存权限'});}catch(e){wx.showToast({title:e.message || '授权失败',icon:'none'});}finally{this.setData({saving:false});}
  },
});
