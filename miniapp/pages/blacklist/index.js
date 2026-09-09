const { ensureLogin } = require('../../utils/auth');
const { request } = require('../../utils/request');
Page({
  data: { items: [], nextOffset: null, loading: false, busy: false, error: '' },
  onShow() { if (ensureLogin()) this.load(false); },
  onPullDownRefresh() { this.load(false).finally(() => wx.stopPullDownRefresh()); },
  async load(more) {
    if (this.data.loading) return;
    const offset = more ? this.data.nextOffset : 0;
    if (offset === null) return;
    this.setData({ loading: true, error: '' });
    try {
      const data = await request('GET', '/blacklist?offset=' + offset);
      this.setData({ items: more ? this.data.items.concat(data.items) : data.items, nextOffset: data.nextOffset });
    } catch (e) { this.setData({ error: e.message || '加载失败，请重试' }); }
    finally { this.setData({ loading: false }); }
  },
  retry() { this.load(false); },
  more() { this.load(true); },
  async remove(e) {
    if (this.data.busy || this.data.loading) return;
    const id = e.currentTarget.dataset.id;
    this.setData({ busy: true });
    try {
      const answer = await new Promise(resolve => wx.showModal({ title:'解除拉黑',content:'解除你设置的拉黑。如果对方仍将你拉黑，沟通仍受限制。',success:resolve,fail:()=>resolve({confirm:false}) }));
      if (!answer.confirm) return;
      await request('DELETE', '/blacklist/' + encodeURIComponent(id));
      wx.showToast({ title:'已解除拉黑',icon:'success' });
      await this.load(false);
    } catch (e) { wx.showToast({ title:e.message || '解除失败',icon:'none' }); }
    finally { this.setData({ busy:false }); }
  },
});
