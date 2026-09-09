const { ensureLogin } = require('../../utils/auth');
const { request } = require('../../utils/request');
Page({
  data: { current: null, levels: [], advancement: null, loading: false, error: '' },
  onShow() {
    const user = ensureLogin();
    if (!user) return;
    if (user.role !== 'ENGINEER') return wx.navigateBack();
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try {
      const d = await request('GET', '/engineers/level');
      this.setData({ ...d, advancement: d.current.advancement,
        positiveText: d.current.positiveRate === null ? '暂无评价' : d.current.positiveRate.toFixed(2) + '%',
        disputeText: d.current.disputeRate.toFixed(2) + '%' });
    } catch (e) { this.setData({ error: e.message || '等级加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  goQualification() { wx.navigateTo({ url: '/pages/engineer-qualification/index' }); },
});
