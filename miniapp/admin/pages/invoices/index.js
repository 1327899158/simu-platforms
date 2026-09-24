const { request, upload } = require('../../../utils/request');
const { loadAdmin, hasPermission, denyAndExit } = require('../../utils/admin');

const { downloadAndOpen, formatDownloadError, deleteCloudFile } = require('../../../utils/cloud-file');

const filters = [
  { key: 'RETURNED', text: '已退回' }, { key: '', text: '全部' }, { key: 'REQUESTED', text: '待处理' }, { key: 'SELF_ISSUE', text: '自行开票中' },
  { key: 'PLATFORM_REQUESTED', text: '平台开票' }, { key: 'ISSUED', text: '已完成' }, { key: 'REJECTED', text: '不支持' },
];

Page({
  async netdiskInvoice(e){
    const id=e.currentTarget.dataset.id;if(this.data.processingId)return;this.setData({processingId:id});
    try{await request('POST',`/admin/invoices/${id}/files`,{fileIds:[e.detail.fileId]});wx.showToast({title:'已交付'});await this.load();}
    catch(error){wx.showToast({title:error.message||'交付失败',icon:'none'});}finally{this.setData({processingId:''});}
  },
  data: { items: [], filters, status: '', loading: true, canProcess: false, processingId: '', downloading: false },
  onLoad(q) { this._invoiceId=q.id || ''; },
  async returnInvoice(e) {
    if(!this.data.canProcess || this.data.processingId)return;
    const result=await new Promise(resolve=>wx.showModal({title:'退回修改',editable:true,placeholderText:'请填写退回原因（至少2字）',success:resolve,fail:()=>resolve({confirm:false})}));
    if(!result.confirm)return;const reason=(result.content || '').trim();if(reason.length<2)return wx.showToast({title:'请填写退回原因',icon:'none'});
    const id=e.currentTarget.dataset.id;this.setData({processingId:id});
    try{await request('POST',`/admin/invoices/${id}/return`,{reason});await this.load();wx.showToast({title:'已退回修改'});}catch(e){wx.showToast({title:e.message || '退回失败',icon:'none'});}finally{this.setData({processingId:''});}
  },
  onShow() { if (!this.data.processingId) this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true });
    try {
      const admin = await loadAdmin();
      if (!hasPermission(admin, 'INVOICE_READ')) return denyAndExit('没有查看发票管理的权限');
      const suffix = '?status='+encodeURIComponent(this.data.status)+(this._invoiceId?'&id='+encodeURIComponent(this._invoiceId):'');
      const data = await request('GET', `/admin/invoices${suffix}`, null, { silent: true });
      this.setData({ items: data.items || [], canProcess: hasPermission(admin, 'INVOICE_PROCESS') });
    } catch (error) { wx.showToast({ title: error.message || '加载失败', icon: 'none' }); }
    finally { this.setData({ loading: false }); }
  },
  async deliverInvoice(e) {
    if (!this.data.canProcess || this.data.processingId) return;
    const id = e.currentTarget.dataset.id;
    const confirmed = await new Promise(resolve => wx.showModal({
      title: '交付平台发票', content: '请上传已核对订单金额和抬头的真实发票文件。提交后客户即可查看；此操作本身不会开具税务发票或发送邮件。',
      success: r => resolve(r.confirm), fail: () => resolve(false),
    }));
    if (!confirmed || this.data.processingId) return;
    this.setData({ processingId: id });
    let fileId;
    try {
      let file;
      if (e.currentTarget.dataset.source === 'image') {
        const selected = await new Promise((resolve, reject) => wx.chooseImage({ count: 1, sourceType: ['album', 'camera'], sizeType: ['original'], success: resolve, fail: reject }));
        const path = (selected.tempFilePaths || [])[0];
        if (path) {
          const ext = /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.exec(path);
          file = { path, name: `发票_${Date.now()}.${ext ? ext[1] : 'jpg'}` };
        }
      } else {
        const selected = await new Promise((resolve, reject) => wx.chooseMessageFile({ count: 1, type: 'all', success: resolve, fail: reject }));
        file = (selected.tempFiles || [])[0];
      }
      if (!file) return;
      if (!/\.(jpe?g|png|gif|webp|bmp|heic|heif|pdf|docx?)$/i.test(file.name || '')) throw new Error('仅支持图片、PDF、Word');
      const f = await upload(file.path || file.tempFilePath, { kind: /\.(pdf|docx?)$/i.test(file.name) ? 'DOC' : 'IMAGE', name: file.name });
      fileId = f.id || f.fileId;
      await request('POST', `/admin/invoices/${id}/files`, { fileIds: [fileId] });
      fileId = null;
      wx.showToast({ title: '发票已交付', icon: 'success' });
      await this.load();
    } catch (error) {
      if (!String(error.errMsg || '').includes('cancel')) wx.showToast({ title: error.message || '交付失败', icon: 'none' });
      if (fileId) {
        // 若提交已成功但响应丢失，后端会拒绝删除已关联文件。
        try {
          const deleted = await request('DELETE', `/files/${fileId}`, null, { silent: true });
          if (deleted.fileID) await deleteCloudFile(deleted.fileID);
        } catch (_) {}
      }
    } finally { this.setData({ processingId: '' }); }
  },
  async openFile(e) {
    if (this.data.downloading) return;
    this.setData({ downloading: true });
    try {
      const info = await request('GET', `/files/${e.currentTarget.dataset.id}/url`, { adminPreview: 1 });
      const result = await downloadAndOpen(info);
      if (result && result.notice) wx.showModal({ title: '文件已下载', content: result.notice, showCancel: false });
    } catch (error) { wx.showModal({ title: '打开失败', content: formatDownloadError(error), showCancel: false }); }
    finally { this.setData({ downloading: false }); }
  },
  select(e) { const status = e.currentTarget.dataset.status; this.setData({ status }); this.load(); },
});
