const { ensureLogin } = require('../../utils/auth');
const { request } = require('../../utils/request');

Page({
  favoriteEngineer(){require('../../utils/community').favorite('ENGINEER',this.data.id);},
  favoriteCase(e){require('../../utils/community').favorite('CASE',e.currentTarget.dataset.id);},
  reportEngineer(){require('../../utils/community').report(this.data.id);},
  cooperation(){wx.navigateTo({url:'/pages/cooperation/index?engineerId='+this.data.id});},
  async blockEngineer() {
    if (!this.data.canContact || this._blocking) return;
    this._blocking = true;
    try { await require('../../utils/blacklist').blockUser(this.data.id); }
    finally { this._blocking = false; }
  },
  data: { id: '', profile: null, cases: [], caseTotal: 0, nextOffset: null, loading: true, loadingCases: false, contacting: false, canContact: false, error: '' },
  onLoad(q) { this._favoriteCaseId=q.caseId||'';this.setData({ id: q.id || '' }); },
  onShow() {
    const user = ensureLogin();
    if (!user) return;
    if (!this.data.id) return wx.navigateBack();
    this.setData({ canContact: user.role === 'CUSTOMER' && user.id !== this.data.id });
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    const token = this._loadToken = (this._loadToken || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const profile = await request('GET', `/engineers/${this.data.id}/profile`);
      if (token !== this._loadToken) return;
      this.setData({ profile, cases: profile.cases.items, caseTotal: profile.cases.total, nextOffset: profile.cases.nextOffset });
      wx.setNavigationBarTitle({ title: profile.nickname || '工程师资料' });
      if(this._favoriteCaseId) {
        const caseId=this._favoriteCaseId;this._favoriteCaseId='';
        try {const item=await request('GET','/public-cases/'+caseId);if(item.engineerId===this.data.id)wx.showModal({title:item.title,content:item.summary,showCancel:false});}
        catch(e){wx.showToast({title:e.message||'案例已停止展示',icon:'none'});}
      }
    } catch (e) { if (token === this._loadToken) this.setData({ error: e.message || '资料加载失败' }); }
    finally { if (token === this._loadToken) this.setData({ loading: false }); }
  },
  async moreCases() {
    if (this.data.loading || this.data.loadingCases || this.data.nextOffset === null) return;
    const token = this._loadToken;
    this.setData({ loadingCases: true });
    try {
      const result = await request('GET', `/engineers/${this.data.id}/cases?offset=${this.data.nextOffset}`);
      if (token === this._loadToken) this.setData({ cases: this.data.cases.concat(result.items), nextOffset: result.nextOffset, caseTotal: result.total });
    } catch (e) { wx.showToast({ title: e.message || '案例加载失败', icon: 'none' }); }
    finally { this.setData({ loadingCases: false }); }
  },
  showLevel() {
    const level = this.data.profile && this.data.profile.level;
    if (!level) return;
    wx.showModal({ title: level.name, content: (level.rule || '需完成实名认证并提交基础资质资料') + '。等级由平台依据真实订单、客户评价和纠纷数据自动计算。', showCancel: false });
  },
  async contact() {
    if (!this.data.canContact || this.data.contacting) return;
    this.setData({ contacting: true });
    try {
      const c = await request('POST', `/engineers/${this.data.id}/conversation`, {});
      wx.navigateTo({ url: '/pages/chat-room/index?id=' + c.id });
    } catch (e) { wx.showToast({ title: e.message || '暂时无法发起沟通', icon: 'none' }); }
    finally { this.setData({ contacting: false }); }
  },
});
