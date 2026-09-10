const { ensureLogin } = require('../../utils/auth');
const { request, upload } = require('../../utils/request');

Page({
  data: { items: [], maxCases: 40, loading: false, error: '', picker: false, candidates: [], nextOffset: null,
    imageIds: [], uploading: false, picking: false, editor: false, caseId: '', orderId: '', orderName: '', title: '', summary: '', confirmed: false, saving: false, removing: '' },
  onShow() {
    const user = ensureLogin();
    if (!user) return;
    if (user.role !== 'ENGINEER') {
      wx.showToast({ title: '仅工程师可管理案例', icon: 'none' });
      return wx.navigateBack();
    }
    this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });
    try { this.setData(await request('GET', '/engineers/me/cases')); }
    catch (e) { this.setData({ error: e.message || '案例加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  async add() {
    if (this.data.loading || this.data.saving) return;
    if (this.data.items.length >= this.data.maxCases) return wx.showToast({ title: `最多 ${this.data.maxCases} 个案例`, icon: 'none' });
    this.setData({ picker: true, candidates: [], nextOffset: null });
    await this.loadCandidates(false);
  },
  async loadCandidates(more = true) {
    if (this.data.picking || (more && this.data.nextOffset === null)) return;
    this.setData({ picking: true });
    try {
      const result = await request('GET', `/engineers/me/case-candidates?offset=${more ? this.data.nextOffset : 0}`);
      this.setData({ candidates: more ? this.data.candidates.concat(result.items) : result.items, nextOffset: result.nextOffset });
    } catch (e) { wx.showToast({ title: e.message || '订单加载失败', icon: 'none' }); }
    finally { this.setData({ picking: false }); }
  },
  moreCandidates() { this.loadCandidates(true); },
  choose(e) {
    const order = this.data.candidates.find(item => item.id === e.currentTarget.dataset.id);
    if (!order || order.caseId) return;
    // 不自动复制原始订单标题或描述，公开文案由工程师另行填写确认。
    this.setData({ picker: false, editor: true, caseId: '', orderId: order.id, orderName: order.projectName, title: '', summary: '', imageIds: [], confirmed: false });
  },
  edit(e) {
    const item = this.data.items.find(item => item.id === e.currentTarget.dataset.id);
    if (!item) return;
    this.setData({ editor: true, caseId: item.id, orderId: item.orderId, orderName: item.projectName, title: item.title, summary: item.summary, imageIds: item.imageIds || [], confirmed: false });
  },
  async addImages() {
    if(this.data.uploading || this.data.saving || this.data.imageIds.length>=9)return;
    this.setData({uploading:true});
    try{
      const selected=await new Promise((resolve,reject)=>wx.chooseMedia({count:9-this.data.imageIds.length,mediaType:['image'],sizeType:['compressed'],success:resolve,fail:reject}));
      for(const file of selected.tempFiles){
        if(file.size>5*1024*1024)throw Error('单张案例图片不能超过5MB');
        const ext=(file.tempFilePath.match(/\.(png|jpe?g|webp)$/i)||[])[1]||'jpg';
        const uploaded=await upload(file.tempFilePath,{kind:'IMAGE',name:'case-'+Date.now()+'.'+ext});
        this.setData({imageIds:this.data.imageIds.concat(uploaded.id||uploaded.fileId),confirmed:false});
      }
    }catch(e){if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:e.message||'图片上传失败',icon:'none'});}
    finally{this.setData({uploading:false});}
  },
  removeImage(e){if(!this.data.uploading&&!this.data.saving)this.setData({imageIds:this.data.imageIds.filter(id=>id!==e.detail.id),confirmed:false});},
  field(e) { const key = e.currentTarget.dataset.key; if (['title', 'summary'].includes(key)) this.setData({ [key]: e.detail.value }); },
  confirm(e) { this.setData({ confirmed: e.detail.value.includes('public') }); },
  close() { if (!this.data.saving && !this.data.uploading) this.setData({ editor: false, picker: false }); },
  async save() {
    if (this.data.saving || this.data.uploading) return;
    if (!this.data.confirmed) return wx.showToast({ title: '请先确认公开展示授权', icon: 'none' });
    if (this.data.title.trim().length < 2 || this.data.summary.trim().length < 10) return wx.showToast({ title: '标题至少2字，介绍至少10字', icon: 'none' });
    this.setData({ saving: true });
    try {
      const id = this.data.caseId;
      await request(id ? 'PATCH' : 'POST', '/engineers/me/cases' + (id ? '/' + id : ''), {
        orderId: this.data.orderId, title: this.data.title.trim(), summary: this.data.summary.trim(), imageIds: this.data.imageIds, confirmPublic: true,
      });
      this.setData({ editor: false });
      wx.showToast({ title: id ? '案例已更新' : '案例已展示', icon: 'success' });
      await this.load();
    } catch (e) { wx.showToast({ title: e.message || '保存失败', icon: 'none' }); }
    finally { this.setData({ saving: false }); }
  },
  async remove(e) {
    if (this.data.removing) return;
    const id = e.currentTarget.dataset.id;
    const result = await new Promise(resolve => wx.showModal({ title: '移除展示案例', content: '只移除公开案例，不会删除原订单及交付文件。', success: resolve, fail: () => resolve({ confirm: false }) }));
    if (!result.confirm || this.data.removing) return;
    this.setData({ removing: id });
    try { await request('DELETE', `/engineers/me/cases/${id}`); await this.load(); }
    catch (e) { wx.showToast({ title: e.message || '移除失败', icon: 'none' }); }
    finally { this.setData({ removing: '' }); }
  },
  preview() { const user = ensureLogin(); if (user) wx.navigateTo({ url: `/pages/engineer-profile/index?id=${user.id}` }); },
  noop() {},
});
