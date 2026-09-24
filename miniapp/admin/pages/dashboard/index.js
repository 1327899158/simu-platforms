const { request } = require('../../../utils/request');
const { loadAdmin, hasPermission, exitAdmin, denyAndExit } = require('../../utils/admin');

Page({
  data: { admin: null, stats: null, loading: true, groups: [], priority: [], tab: 'home', collapsed: {}, error: '' },
  onShow() {
    this.load();
    clearInterval(this._timer);
    this._timer = setInterval(() => this.load(true), 15000);
  },
  onHide() { clearInterval(this._timer); },
  onUnload() { clearInterval(this._timer); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load(silent = false) {
    if (this._loading) return;
    this._loading = true;
    if (!silent) this.setData({ loading: true });
    try {
      const admin = await loadAdmin();
      const stats = await request('GET', '/admin/dashboard', null, { silent: true });
      const groups = require('../../utils/navigation').navigation(admin, stats, hasPermission);
      let overview = null;
      try { overview = await request('GET', '/admin/console/overview', null, { silent: true }); } catch (_) {}
      const menus = groups.flatMap(group => group.items);
      const priority = menus.filter(item => ['engineers','enterprise','disputes','support','customer-service','invoices','wallet'].includes(item.key));
      this.setData({ admin, stats, groups, priority, pending: menus.reduce((sum,item) => sum+item.count,0), overview, canReview: groups.some(group => group.key === 'review'),
        todayPaid: overview ? (Number(overview.todayPaidFen)/100).toFixed(2) : '—', error: '' });
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 401) denyAndExit(error.message);
      else if (!silent) this.setData({ error: error.message || '工作台加载失败，请重试' });
    } finally {
      this.setData({ loading: false });
      this._loading = false;
    }
  },
  toggle(e) { const key=e.currentTarget.dataset.key; this.setData({ ['collapsed.'+key]: !this.data.collapsed[key] }); },
  selectTab(e) { const tab=e.currentTarget.dataset.tab; if(tab==='data') { wx.navigateTo({url:'/admin/pages/data-preview/index'}); return; } this.setData({tab}); wx.pageScrollTo({scrollTop:0}); },
  retry() { this.load(); },
  open(e) { wx.navigateTo({ url: e.currentTarget.dataset.path }); },
  exit() { exitAdmin(); },
});
