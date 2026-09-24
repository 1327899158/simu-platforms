const { request } = require('../../../utils/request');
const { loadAdmin, hasPermission, denyAndExit } = require('../../utils/admin');
const { timeShort } = require('../../../utils/format');
const META = {
  operations: ['运营分析', '发现问题 · 定位原因 · 跟踪优化效果', 'DASHBOARD_READ'],
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
  data: { planTitle:'',planGoal:'',planDate:'',planSaving:false,canSavePlan:false, operationTab:'overview',operationTabs:[{key:'overview',label:'交易与异常'},{key:'supply',label:'领域供需'},{key:'users',label:'用户与质量'},{key:'promotion',label:'推广效果'},{key:'service',label:'客服效率'},{key:'income',label:'收入成本'},{key:'improve',label:'优化跟踪'}], kind:'',title:'平台管理',subtitle:'',loading:true,error:'',metrics:[],sections:[],links:[],items:[],roles:[],days:30,dayOptions:[7,30,90],offset:0,hasMore:false,form:null,saving:false,hotQuoteWeight:'3' },
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
    if(kind==='operations') {
      const pct=(n,total)=>Number(total)?(Number(n||0)/Number(total)*100).toFixed(1)+'%':'—';
      const dec=n=>n==null?'—':Number(n).toFixed(1);
      const current=d.current||{},previous=d.previous||{};
      this.setData({canSavePlan:hasPermission(admin,'CONFIG_MANAGE'),funnelSteps:d.funnel.map(x=>({...x,width:Math.max(0,Math.min(100,Number(x.share||0)))}))});
      metrics=[metric('本期发布需求',current.total||0),metric('已支付 / 发布',pct(current.paid,current.total)),metric('收到报价 / 发布',pct(current.quoted,current.total)),metric('首份报价平均耗时',dec(current.firstQuoteHours)+' 小时'),metric('退款申请订单占比',pct(current.refunds,current.total)),metric('有效纠纷订单占比',pct(current.disputes,current.total))];
      const orderLink=id=>d.permissions.orders?path('order-detail')+'?id='+id:'';
      const reasons={NO_QUOTE:'超过48小时无人报价',NOT_SELECTED:'发布超过48小时，已有报价未选择',DISPUTE:'进行中纠纷超过7天',UNPAID:'选定工程师超过24小时未支付'};
      const compare=(label,key)=>row(key,label,'本期 '+Number(current[key]||0)+' / 上期 '+Number(previous[key]||0),'变化 '+(Number(current[key]||0)-Number(previous[key]||0)));
      sections=[
        {title:'交易转化漏斗 · 本期发布需求的当前进展',rows:d.funnel.map(x=>row(x.key,x.label,'占发布需求 '+(x.share==null?'—':x.share+'%')+' · 相对上一阶段 '+(x.conversion==null?'—':x.conversion+'%'),x.count+' 单'))},
        {title:'与上一等长周期比较',rows:[compare('发布需求','total'),compare('已支付订单','paid'),compare('完成订单','completed'),row('conversion','支付转化率','本期 '+pct(current.paid,current.total)+' / 上期 '+pct(previous.paid,previous.total),'观察中')]},
        {title:'异常订单 · 全部时间 · 最早50条'+(d.exceptionsMore?'（还有更多，请到订单管理查看）':''),rows:d.permissions.orders?d.exceptions.map(x=>row(x.id,x.projectName,x.orderNo+' · '+reasons[x.category],'查看订单',orderLink(x.id))):[row('permission','需要订单查看权限','请联系超级管理员授权','无权限')]},
        {title:'逾期交付 · 当前有效交付期限 · 最早50条'+(d.overdueMore?'（还有更多）':''),rows:d.overdue.map(x=>row(x.id,x.projectName,x.orderNo+' · 截止 '+timeShort(x.deadline),'查看订单',orderLink(x.id)))},
        {title:'领域供需与质量 · 按发布需求分组',rows:d.directions.map(x=>row(x.name,x.name,'需求 '+x.demand+' · 已报价 '+x.quoted+' · 完成 '+x.completed+' · 当前认证工程师 '+x.engineers+'\n退款订单 '+x.refunds+' · 纠纷订单 '+x.disputes,'无人报价 '+(x.noQuoteRate==null?'—':x.noQuoteRate+'%')))},
        {title:'每日发布趋势 · 北京时间 · 仅显示有记录日期',rows:d.daily.map(x=>row(x.day,x.day,'这些需求目前已支付 '+x.paid+' · 已完成 '+x.completed,x.total+' 单'))},
        {title:'客户复购 · 全历史成熟首付客户',rows:d.retention.map(x=>row(x.days,x.days+'天内再次支付','已满观察期客户 '+x.eligible+' · 复购客户 '+(x.repeated||0),x.rate==null?'—':x.rate+'%'))},
        {title:'工程师活跃与服务评价',rows:[row('active','本期报价工程师','去重工程师数',d.activity.active||0),row('return','连续两期参与报价','本期活跃中，上期也报价的人数',d.activity.returningEngineers||0),row('quality','订单评价均分','本期评价 '+d.quality.count+' 条；质量、态度、速度三项平均',dec(d.quality.average)),row('low','低分评价占比','三项平均分低于3分；样本 '+d.quality.count,pct(d.quality.lowCount,d.quality.count))]},
        {title:'推广表现 · 本期发布需求的累计表现',rows:d.promotions.map(x=>row(x.promotion||'NONE',({EXPOSURE:'增加曝光 · 19元/次',URGENT:'置顶加急 · 29元/次',NONE:'普通需求'})[x.promotion]||'普通需求','需求 '+x.count+' · 累计浏览 '+x.views+' · 收到报价 '+x.quoted,'已支付 '+x.paid))},
        {title:'客服响应 · 本期创建会话 / 工单',rows:d.service.map(x=>row(x.channel,x.channel==='CHAT'?'在线咨询':'工单','总数 '+x.count+' · 当前未解决 '+(x.unresolved||0)+' · 已首次回复 '+(x.replied||0),'平均首响 '+dec(x.firstReplyMinutes)+' 分钟'))},
        {title:'客服积压与问题分布',rows:d.backlog.map(x=>row('backlog-'+x.channel,(x.channel==='CHAT'?'在线咨询':'工单')+'当前积压','全部时间未解决记录；其中创建超过24小时 '+(x.olderDay||0),x.count+' 条')).concat(d.issues.map(x=>row(x.category,x.category,'本期创建记录',x.count+' 次')))},
        {title:'新客转化与流失分析',rows:[row('registration','新客户注册→发布→支付','本期注册 '+(d.newCustomers.registered||0)+' · 已发布 '+(d.newCustomers.published||0)+' · 已支付 '+(d.newCustomers.paid||0)+'；按本期注册客户统计截至目前行为，含定向订单',pct(d.newCustomers.paid,d.newCustomers.registered)),row('visits','页面访问与登录留存','缺少统一访问事件和会话记录','待接入'),row('reason','未成交原因分析','已有退款/纠纷原因可在大厅统计查看；取消需求、放弃报价等原因尚未完整采集','待采集')]},
        {title:'待接入 · 推广与客服效果',rows:[row('impression','推广展示量、点击率与投入产出','缺少推广展示/点击事件及实际收费流水；累计浏览不能作为点击率分母','待接入'),row('satisfaction','客服满意度与解决时长','缺少满意度评价及独立解决事件记录；不使用updatedAt代替解决时间','待接入')]},
        {title:'收入与成本分析',rows:[row('finance','支付、发票、推广标价及模拟提现','进入已有财务中心查看；订单流水不等于平台收入','财务报表',hasPermission(admin,'FINANCE_READ')?path('finance'):''),row('profit','实际佣金、手续费、补贴与净收入','真实结算与成本账本尚未接入，暂不能计算利润','待接入')]},
        {title:'优化措施记录',rows:(d.plans||[]).map(x=>row(x.id,x.title,x.startDate+' · '+x.owner+'\n'+x.goal,'已记录')).concat([row('experiment','自动效果归因','当前支持记录措施与目标；跨期指标可在交易面板对比，自动归因与实验分组尚未接入','待接入')])}
      ];
      sections.push({title:'工程师服务质量 · 本期选定订单数前20名',rows:(d.engineerQuality||[]).map(x=>row(x.engineerId,x.nickname||'工程师','样本 '+x.orders+' 单 · 当前完成 '+x.completed+' · 退款申请 '+x.refunds+' · 有效纠纷 '+x.disputes,'退款占比 '+pct(x.refunds,x.orders)))});
      links=[];
      this.setData({notice:'近'+d.dates.days+'天滚动窗口，截止 '+timeShort(d.dates.until.replace(' ','T')+'Z')+'。转化、供需和推广按公开需求创建时间分组，含后续关闭记录，排除定向订单；统计截至当前的进展，近期订单尚未成熟，周期比较不能直接证明优化效果。报价按留存记录统计，撤回删除的报价无法还原。复购统计全历史支付（含定向），已满观察期才进入分母。支付含模拟数据。领域可多选，不能相加。推广分组差异不代表推广造成的提升。'});
    } else if(kind==='finance') {
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
    if(kind==='operations'){this._operationSections=sections;sections=this.operationSections();}
    this.setData({metrics,sections,links:links.filter(i=>hasPermission(admin,i[2])).map(i=>({title:i[0],path:path(i[1])}))});
  },
  inputPlan(e) { const key=e.currentTarget.dataset.key;if(['planTitle','planGoal'].includes(key))this.setData({[key]:e.detail.value}); },
  pickPlanDate(e) { this.setData({planDate:e.detail.value}); },
  async savePlan() {
    if(this.data.planSaving)return;
    if(this.data.planTitle.trim().length<2||this.data.planGoal.trim().length<2||!this.data.planDate){wx.showToast({title:'请填写名称、目标和执行日期',icon:'none'});return;}
    this.setData({planSaving:true});
    try{await request('POST','/admin/console/operations/plans',{title:this.data.planTitle.trim(),goal:this.data.planGoal.trim(),startDate:this.data.planDate});this.setData({planTitle:'',planGoal:'',planDate:''});wx.showToast({title:'措施已记录'});await this.load();}
    catch(e){wx.showToast({title:e.message||'保存失败',icon:'none'});}finally{this.setData({planSaving:false});}
  },
  operationSections() {
    const indexes={overview:[0,1,2,3,5],supply:[4],users:[6,7,11,15],promotion:[8,12],service:[9,10,12],income:[13],improve:[14]};
    return (indexes[this.data.operationTab]||indexes.overview).map(i=>(this._operationSections||[])[i]).filter(Boolean);
  },
  changeOperationTab(e) { this.setData({operationTab:e.currentTarget.dataset.key});this.setData({sections:this.operationSections()}); },
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
