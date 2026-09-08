const { ensureLogin } = require('../../utils/auth');
const { request } = require('../../utils/request');
const STARS = [1, 2, 3, 4, 5];
const TAGS = ['需求描述清晰', '回复及时', '配合验收', '沟通友善', '按时付款', '需求反复修改'];
Page({
  data: { orderId:'', order:null, customer:null, score:0, stars:STARS, tagOptions:TAGS.map(value => ({value,selected:false})), selectedTags:[], content:'', editing:false, saving:false },
  async onLoad(q) {
    const user = ensureLogin();
    if (!user || !q.orderId) return;
    if (user.role !== 'ENGINEER') return wx.showToast({ title: '仅工程师可评价客户', icon: 'none' });
    this.setData({ orderId:q.orderId, editing:q.edit === '1' });
    try {
      const order = await request('GET', `/market/orders/${q.orderId}`);
      if (order.status !== 'COMPLETED' || !order.iAmSelected) throw new Error('仅已完成且已承接的订单可评价客户');
      const review = order.customerReview;
      if (this.data.editing && !review) throw new Error('尚未提交客户评价');
      if (review && Number(review.revisionCount || 0) >= 1) throw new Error('该评价已修改过，不能再次修改');
      const selectedTags = review ? (review.tags || []) : [];
      this.setData({ editing: !!review, order: { ...order, finalY: order.finalAmountFen == null ? '—' : (Number(order.finalAmountFen) / 100).toFixed(2) }, customer:order.customer, score:review ? Number(review.score) : 0, selectedTags, tagOptions:TAGS.map(value => ({value,selected:selectedTags.includes(value)})), content:review ? (review.content || '') : '' });
    } catch (e) { wx.showToast({title:e.message || '评价信息加载失败', icon:'none'}); setTimeout(() => wx.navigateBack(), 800); }
  },
  chooseStar(e) { this.setData({ score:Number(e.currentTarget.dataset.score) }); },
  toggleTag(e) { const tag=e.currentTarget.dataset.tag; const selected=this.data.selectedTags.slice(); const i=selected.indexOf(tag); if(i>=0) selected.splice(i,1); else selected.push(tag); this.setData({selectedTags:selected,tagOptions:TAGS.map(value => ({value,selected:selected.includes(value)}))}); },
  inputContent(e) { this.setData({content:String(e.detail.value || '').slice(0,500)}); },
  async submit() {
    if (this.data.saving || !this.data.order) return;
    if (!this.data.score) return wx.showToast({title:'请选择客户评分',icon:'none'});
    this.setData({saving:true});
    try { await request(this.data.editing ? 'PATCH' : 'POST', `/orders/${this.data.orderId}/customer-review`, {score:this.data.score,tags:this.data.selectedTags,content:this.data.content}); wx.showToast({title:this.data.editing?'评价已修改':'评价已提交',icon:'success'}); setTimeout(() => wx.navigateBack(), 500); }
    catch(e) { wx.showToast({title:e.message || '提交失败',icon:'none'}); }
    finally { this.setData({saving:false}); }
  },
});
