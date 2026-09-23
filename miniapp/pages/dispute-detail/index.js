/** 纠纷详情：双方在发起后的 48 小时内补充证据，截止后等待平台仲裁。 */
const { ensureLogin } = require('../../utils/auth');
const { request, upload } = require('../../utils/request');
const { downloadAndOpen, formatDownloadError } = require('../../utils/cloud-file');
const { timeShort, fenToYuan } = require('../../utils/format');

const MAX_EVIDENCE_PER_PARTY = 20;
const MAX_FILES_PER_UPLOAD = 10;

function pad2(value) { return String(value).padStart(2, '0'); }

Page({
  async netdiskEvidence(e){
    if(this.data.uploading)return;this.setData({uploading:true});
    try{await request('POST',`/disputes/${this.data.id}/evidence`,{fileIds:[e.detail.fileId],description:this.data.evidenceDescription});this.setData({evidenceDescription:''});await this.load();}
    catch(error){wx.showToast({title:error.message||'提交失败',icon:'none'});}finally{this.setData({uploading:false});}
  },
  data: {
    id: '', myId: '', dispute: null,
    uploading: false, evidenceCountdown: '', evidenceDescription: '', pendingEvidence: [],
  },
  _countdownTimer: null,
  _deadlineMs: 0,

  onLoad(q) {
    const user = ensureLogin();
    if (!user) return;
    if (!q.id) { wx.showToast({ title: '缺少纠纷ID', icon: 'none' }); return; }
    this.setData({ id: q.id, myId: user.id });
  },
  onShow() { this.load(); clearInterval(this._poll); this._poll=setInterval(()=>this.load(),10000); },
  onHide() { clearInterval(this._poll); this.stopCountdown(); },
  onUnload() { clearInterval(this._poll); this.stopCountdown(); },

  async load() {
    try {
      const d = await request('GET', `/disputes/${this.data.id}`, null, { silent: true });
      const dispute = this.normalize(d);
      this.setData({ dispute });
      this.startCountdown(dispute.evidenceDeadlineAt, dispute.evidenceOpen);
    } catch (e) {
      wx.showToast({ title: e.message || '纠纷加载失败', icon: 'none' });
    }
  },

  normalize(d) {
    const statusCls = { OPEN: 'st-orange', RESOLVED: 'st-green', CANCELLED: 'st-gray' }[d.status] || 'st-gray';
    const evidence = (d.evidence || []).map((f) => ({
      ...f,
      sizeText: this.sizeText(f.sizeBytes),
      timeText: timeShort(f.createdAt),
      uploaderText: f.uploaderId === this.data.myId
        ? '我提交的'
        : (f.uploaderRole === 'ENGINEER' ? '工程师提交' : '客户提交'),
    }));
    return {
      ...d,
      refundY: d.refundAmountFen == null ? null : fenToYuan(d.refundAmountFen),
      createdText: timeShort(d.createdAt),
      resolvedText: timeShort(d.resolvedAt),
      deadlineText: this.dateTimeText(d.evidenceDeadlineAt),
      statusCls,
      evidence,
      myEvidenceCount: evidence.filter((f) => f.uploaderId === this.data.myId).length,
    };
  },

  sizeText(bytes) {
    const size = Number(bytes || 0);
    if (!size) return '大小未知';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))}KB`;
    return `${(size / 1024 / 1024).toFixed(2)}MB`;
  },

  dateTimeText(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  },

  startCountdown(deadlineAt, evidenceOpen) {
    this.stopCountdown();
    this._deadlineMs = new Date(deadlineAt).getTime();
    if (!evidenceOpen) {
      this.setData({ evidenceCountdown: '举证已结束' });
      return;
    }
    this.tickCountdown();
    if (Number.isFinite(this._deadlineMs) && this._deadlineMs > Date.now()) {
      this._countdownTimer = setInterval(() => this.tickCountdown(), 1000);
    }
  },

  stopCountdown() {
    if (this._countdownTimer) clearInterval(this._countdownTimer);
    this._countdownTimer = null;
  },

  tickCountdown() {
    const remaining = Math.max(0, Math.ceil((this._deadlineMs - Date.now()) / 1000));
    if (!remaining) {
      this.stopCountdown();
      this.setData({ evidenceCountdown: '举证已结束', 'dispute.evidenceOpen': false });
      return;
    }
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    this.setData({ evidenceCountdown: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}` });
  },

  addEvidence() {
    const { dispute, pendingEvidence, uploading } = this.data;
    if (!dispute?.evidenceOpen || uploading || this._choosingEvidence) return;
    const count = Math.min(MAX_FILES_PER_UPLOAD - pendingEvidence.length,
      MAX_EVIDENCE_PER_PARTY - Number(dispute.myEvidenceCount || 0) - pendingEvidence.length);
    if (count <= 0) return wx.showToast({ title: '本次最多10张，每人累计最多20份', icon: 'none' });
    this._choosingEvidence = true;
    wx.chooseMedia({
      count: Math.min(9, count), mediaType: ['image'], sourceType: ['album', 'camera'],
      success: result => {
        const files = (result.tempFiles || []).slice(0, count).map(file => ({ path: file.tempFilePath }));
        this.setData({ pendingEvidence: this.data.pendingEvidence.concat(files) });
      },
      complete: () => { this._choosingEvidence = false; },
    });
  },
  removePendingEvidence(e) {
    if (this.data.uploading) return;
    const files = this.data.pendingEvidence.slice();
    files.splice(Number(e.currentTarget.dataset.index), 1);
    this.setData({ pendingEvidence: files });
  },
  previewPendingEvidence(e) {
    const urls = this.data.pendingEvidence.map(file => file.path);
    wx.previewImage({ urls, current: urls[Number(e.currentTarget.dataset.index)] });
  },
  async submitEvidence() {
    const { dispute, pendingEvidence, uploading } = this.data;
    if (!dispute?.evidenceOpen || uploading) return;
    if (!pendingEvidence.length) return wx.showToast({ title: '请先选择证据图片', icon: 'none' });
    if (pendingEvidence.length > MAX_FILES_PER_UPLOAD || pendingEvidence.length + Number(dispute.myEvidenceCount || 0) > MAX_EVIDENCE_PER_PARTY) {
      return wx.showToast({ title: '已超过可提交的证据数量', icon: 'none' });
    }
    const description = this.data.evidenceDescription.trim();
    this.setData({ uploading: true });
    wx.showLoading({ title: '上传证据中…', mask: true });
    try {
      const fileIds = [];
      for (const file of pendingEvidence) {
        // 保留成功上传的ID，提交失败重试时不重复上传云文件。
        if (!file.fileId) {
          const ext = /\.([a-zA-Z0-9]+)$/.exec(file.path);
          const saved = await upload(file.path, { kind: 'IMAGE', name: 'evidence.' + (ext ? ext[1] : 'jpg') });
          file.fileId = saved.id || saved.fileId;
        }
        fileIds.push(file.fileId);
      }
      await request('POST', '/disputes/' + this.data.id + '/evidence', { fileIds, description }, { silent: true });
      this.setData({ evidenceDescription: '', pendingEvidence: [] });
      wx.hideLoading();
      wx.showToast({ title: '证据已提交', icon: 'success' });
      await this.load();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '证据上传失败', icon: 'none' });
      await this.load();
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
  },

  inputEvidenceDescription(e) { this.setData({ evidenceDescription: e.detail.value }); },

  async openEvidence(e) {
    const file = this.data.dispute.evidence[e.currentTarget.dataset.index];
    if (!file) return;
    wx.showLoading({ title: '正在打开…', mask: true });
    try {
      const info = await request('GET', `/files/${file.fileId}/url`, null, { silent: true });
      await downloadAndOpen(info);
    } catch (error) {
      wx.showModal({ title: '文件打开失败', content: formatDownloadError(error), showCancel: false });
    } finally { wx.hideLoading(); }
  },
});
