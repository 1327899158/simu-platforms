/** 首页：按角色分流 —— 客户（发布入口+最近订单）/ 工程师（可接需求预览）。 */
const { ensureLogin, getUser } = require('../../utils/auth');
const { request } = require('../../utils/request');
const { fenToYuan, timeShort, STATUS_CLASS } = require('../../utils/format');
const { isApproved, promptIdentity } = require('../../utils/identity');

Page({
  data: {
    keyword: '',
    role: '',
    user: null,
    canTakeOrders: false,
    // 客户
    recent: [],
    counts: { UNQUOTED: 0, AWAITING_CONFIRMATION: 0, AWAITING_PAYMENT: 0, IN_PROGRESS: 0, DELIVERED: 0 },
    unreadOrderCount: 0,
    unreadQuoteCount: 0,
    // 工程师
    hall: [], exposures: [],
    hallStats: { allCount: null, todayCount: null },
    campaigns: [], notices: [], engineers: [], categories: [],
    sharePopupVisible: false,
    shareCampaign: null,
  },
  async onShow() {
    this._exposureActive=true;
    clearInterval(this._quoteTimer);
    let user = ensureLogin();
    if (!user) return;
    require('../../utils/invitation').accept();
    try {
      user = await request('GET', '/me', null, { silent: true });
      wx.setStorageSync('user', user);
    } catch (_) {}
    if(this.data.user?.id!==user.id)this._exposureSeen=new Set();
    const canTakeOrders = user.role === 'ENGINEER' && isApproved(user);
    this.setData({
      role: user.role,
      user,
      canTakeOrders,
      unreadQuoteCount: 0,
    });
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar && tabBar.syncTabBar) tabBar.syncTabBar(user.role, '/pages/home/index');
    this.loadSharePopup(user.id);
    if (user.role === 'ENGINEER') {
      this.loadQuoteUnread();
      this._quoteTimer = setInterval(() => this.loadQuoteUnread(), 15000);
      if (canTakeOrders) { this.loadHall(); this.loadExposures(); }
      else this.setData({ hall: [],exposures:[] });
    } else {
      this.loadCustomer();
      this.loadDiscovery();
      clearInterval(this._noticeTimer);
      this._noticeTimer = setInterval(() => this.loadNotices(), 15000);
    }
  },
  onHide() { this.setData({sharePopupVisible:false});this._exposureActive=false;require('../../utils/exposure-tracker').stop(this); clearInterval(this._noticeTimer); clearInterval(this._quoteTimer); },
  onUnload() { this._exposureActive=false;require('../../utils/exposure-tracker').stop(this); clearInterval(this._noticeTimer); clearInterval(this._quoteTimer); },
  async loadQuoteUnread() {
    const userId = this.data.user && this.data.user.id;
    try {
      const data = await request('GET', '/quotes/mine/unread', null, { silent: true });
      if (this.data.role === 'ENGINEER' && this.data.user?.id === userId) {
        this.setData({ unreadQuoteCount: Number(data.unreadCount || 0) });
      }
    } catch (_) {}
  },
  async loadSharePopup(userId) {
    const loginShare = require('../../utils/login-share');
    const ticket = loginShare.pending(userId);
    if (!ticket || this._sharePopupLoading === ticket.version) return;
    this._sharePopupLoading = ticket.version;
    try {
      const campaigns = await request('GET', '/home/campaigns', null, {silent:true});
      const campaign = campaigns.find(x => x.id === 'invite' && x.action === 'SHARE');
      if (!campaign || !loginShare.isCurrent(ticket) || !this._exposureActive || this.data.user?.id !== userId || getUser()?.id !== userId) return;
      if(campaign){try{const invitation=await request('GET','/invitations',null,{silent:true});campaign.sharePath=invitation.sharePath;}catch(_){} }
      if (!campaign || !this._exposureActive || this.data.user?.id !== userId || getUser()?.id !== userId) return;
      if (loginShare.consume(ticket)) {
        require('../../utils/exposure-tracker').stop(this);
        this.setData({shareCampaign:campaign, sharePopupVisible:true});
      }
    } catch (_) { /* 活动读取失败不影响登录及首页操作，返回首页时可重试。 */ }
    finally { if (this._sharePopupLoading === ticket.version) this._sharePopupLoading = null; }
  },
  closeSharePopup() {
    this.setData({sharePopupVisible:false}, () => {
      if (this._exposureActive && this.data.canTakeOrders) require('../../utils/exposure-tracker').observe(this);
    });
  },
  stopSharePopupTap() {},
  openInviteActivity(){this.closeSharePopup();wx.navigateTo({url:'/pages/invite-poster/index'});},
  onShareAppMessage(e) {
    const inviting = e && e.from === 'button' && e.target?.id === 'login-invite-share';
    if (inviting) this.closeSharePopup();
    return {title:inviting ? this.data.shareCampaign?.title || '邀请你体验仿真服务平台' : '仿真服务平台 · 找专业工程师', path:inviting ? this.data.shareCampaign?.sharePath || '/pages/guest-home/index' : '/pages/guest-home/index'};
  },
  async loadNotices() {
    try { this.setData({ notices: await request('GET','/home/notices',null,{silent:true}) }); } catch (_) {}
  },
  async loadDiscovery() {
    this.loadNotices();
    try {
      const [campaigns,directory] = await Promise.all([request('GET','/home/campaigns'),request('GET','/home/engineers')]);
      this.setData({ campaigns, categories:directory.categories, engineers:directory.items.slice(0,4).map(x=>({...x,positiveText:x.level.positiveRate===null?'暂无评价':x.level.positiveRate.toFixed(1)+'%'})) });
    } catch (_) {}
  },
  openCampaign(e) { wx.navigateTo({url:'/pages/activity/index?id='+e.currentTarget.dataset.id}); },
  goEstimate() { wx.navigateTo({url:'/pages/estimate/index'}); },
  goEngineers(e) { wx.navigateTo({url:'/pages/engineer-directory/index?direction='+encodeURIComponent(e.currentTarget.dataset.direction||'')}); },
  openEngineer(e) { wx.navigateTo({ url: '/pages/engineer-profile/index?id=' + encodeURIComponent(e.currentTarget.dataset.id) }); },
  async contactEngineer(e) {
    try { const c=await request('POST',`/engineers/${e.currentTarget.dataset.id}/conversation`,{}); wx.navigateTo({url:'/pages/chat-room/index?id='+c.id}); } catch (_) {}
  },
  onPullDownRefresh() {
    const p = this.data.role === 'ENGINEER'
      ? Promise.all([this.loadQuoteUnread(), this.data.canTakeOrders ? Promise.all([this.loadHall(),this.loadExposures()]) : Promise.resolve()])
      : Promise.all([this.loadCustomer(), this.loadDiscovery()]);
    p.finally(() => wx.stopPullDownRefresh());
  },

  // ---------- 客户 ----------
  async loadCustomer() {
    let data;
    try { data = await request('GET', '/orders/mine', { limit: 20 }); }
    catch (e) { wx.showToast({ title: e.message || '订单加载失败', icon: 'none' }); return; }
    const counts = { UNQUOTED: 0, AWAITING_CONFIRMATION: 0, AWAITING_PAYMENT: 0, IN_PROGRESS: 0, DELIVERED: 0, ...(data.counts || {}) };
    this.setData({
      counts,
      unreadOrderCount: Number(data.unreadCount || 0),
      recent: data.items.slice(0, 5).map((o) => ({
        ...o, budgetY: fenToYuan(o.budgetFen), time: timeShort(o.createdAt),
        cls: STATUS_CLASS[o.status] || 'st-gray',
      })),
    });
  },
  goPublish() {
    if (this.data.role !== 'CUSTOMER') return wx.showToast({ title: '仅客户可以发布需求', icon: 'none' });
    if (!isApproved(this.data.user)) return promptIdentity('发布需求');
    wx.navigateTo({ url: '/pages/publish/index' });
  },
  async goOrders() {
    if (this.data.role !== 'CUSTOMER') return wx.showToast({ title: '仅客户可以查看我的订单', icon: 'none' });
    if (this.data.unreadOrderCount) {
      this.setData({ unreadOrderCount: 0 });
      request('POST', '/orders/mine/mark-read', null, { silent: true }).catch(() => {});
    }
    wx.navigateTo({ url: '/pages/orders/index' });
  },
  goIncentives(){wx.navigateTo({url:'/pages/incentives/index'});},
  goMessages() { wx.switchTab({ url: '/pages/chat-list/index' }); },
  goMe() { wx.switchTab({ url: '/pages/me/index' }); },
  goProfile() { wx.navigateTo({ url: '/pages/profile-edit/index' }); },

  // ---------- 工程师 ----------
  async loadExposures() {
    const userId=this.data.user?.id;
    try {
      const r=await request('GET','/home/exposures',null,{silent:true});
      if(!this._exposureActive||this.data.user?.id!==userId||!this.data.canTakeOrders)return;
      this.setData({exposures:r.items.map(o=>({...o,budgetY:fenToYuan(o.budgetFen)})),hall:this.data.hall.filter(o=>!r.items.some(e=>e.id===o.id))},()=>require('../../utils/exposure-tracker').observe(this));
    }catch(_){if(this._exposureActive)this.setData({exposures:[]});}
  },
  async loadHall() {
    if (!this.data.canTakeOrders) return;
    const params = { limit: 5, placement: 'home' };
    let data;
    try { data = await request('GET', '/market/orders', params); }
    catch (e) { wx.showToast({ title: e.message || '抢单大厅加载失败', icon: 'none' }); return; }
    this.setData({
      hallStats: data.stats || { allCount: null, todayCount: null },
      hall: data.items.filter(o=>!this.data.exposures.some(e=>e.id===o.id)).map((o) => ({
        ...o, budgetY: fenToYuan(o.budgetFen), time: timeShort(o.createdAt),
      })),
    });
  },
  goMyQuotes() { wx.navigateTo({ url: '/pages/my-quotes/index' }); },
  inputSearch(e) { this.setData({keyword:e.detail.value}); },
  searchDemands() {
    if (!this.data.canTakeOrders) return promptIdentity('搜索需求');
    getApp().globalData = getApp().globalData || {};
    getApp().globalData.marketSearch = this.data.keyword.trim();
    wx.switchTab({url:'/pages/market/index'});
  },
  goMarketHall() {
    if (this.data.role !== 'ENGINEER') return wx.showToast({ title: '仅工程师可以进入接单大厅', icon: 'none' });
    if (!this.data.canTakeOrders) return promptIdentity('进入接单大厅');
    wx.switchTab({ url: '/pages/market/index' });
  },
  // 大厅卡片上的快捷报价：与 order-detail 的 goQuote 参数格式保持一致
  quickQuote(e) {
    if (!this.data.canTakeOrders) return promptIdentity('报价');
    const { id, flexible, fen } = e.currentTarget.dataset;
    let url = `/pages/quote-form/index?orderId=${id}&flexible=${flexible}`;
    if (String(flexible) === '0' && fen) url += `&fixedFen=${fen}`;
    wx.navigateTo({ url });
  },
  openMarket(e) {
    if (!this.data.canTakeOrders) return promptIdentity('查看可接需求');
    wx.navigateTo({ url: `/pages/order-detail/index?id=${e.currentTarget.dataset.id}&mode=market` });
  },
  openMine(e) {
    wx.navigateTo({ url: `/pages/order-detail/index?id=${e.currentTarget.dataset.id}&mode=customer` });
  },
});
