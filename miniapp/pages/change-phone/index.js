const { request } = require('../../utils/request');
const { getPasswordResetTarget } = require('../../utils/auth');
const { digits } = require('../../utils/input');
Page({
  data: { username: '', phoneMasked: '', step: 1, phone: '', smsCode: '', countdown: 0, busy: false, ready: false },
  async onLoad(options) {
    this.setData({ username: options.username || '' });
    try {
      const result = await getPasswordResetTarget(this.data.username);
      this.setData({ phoneMasked: result.phoneMasked, ready: true });
    } catch (e) { this.error(e); }
  },
  onUnload() { clearInterval(this.timer); this.token = ''; },
  error(e) { wx.showToast({ title: e.message || '操作失败，请稍后重试', icon: 'none' }); },
  onPhone(e) { this.setData({ phone: digits(e.detail.value, 11), smsCode: '' }); },
  onCode(e) { this.setData({ smsCode: digits(e.detail.value, 6) }); },
  restart() {
    clearInterval(this.timer); this.token = '';
    this.setData({ step: 1, phone: '', smsCode: '', countdown: 0 });
  },
  async sendCode() {
    if (this.data.busy || !this.data.ready || this.data.countdown > 0) return;
    if (this.data.step === 2 && !/^1\d{10}$/.test(this.data.phone)) return this.error({ message: '请输入正确的新手机号' });
    this.setData({ busy: true });
    try {
      const result = await request('POST', '/auth/phone-change/sms', {
        username: this.data.username, stage: this.data.step === 1 ? 'OLD' : 'NEW', phone: this.data.phone, token: this.token,
      }, { silent: true });
      wx.showToast({ title: result.sent === false ? '请稍后再试' : '验证码已发送', icon: 'none' });
      this.setData({ countdown: result.nextRetry || 60 });
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.setData({ countdown: Math.max(0, this.data.countdown - 1) });
        if (!this.data.countdown) clearInterval(this.timer);
      }, 1000);
    } catch (e) { this.error(e); }
    finally { this.setData({ busy: false }); }
  },
  async submit() {
    if (this.data.busy || !this.data.ready) return;
    if (!/^\d{6}$/.test(this.data.smsCode)) return this.error({ message: '请输入6位验证码' });
    if (this.data.step === 2 && !/^1\d{10}$/.test(this.data.phone)) return this.error({ message: '请输入正确的新手机号' });
    this.setData({ busy: true });
    try {
      if (this.data.step === 1) {
        const result = await request('POST', '/auth/phone-change/verify-old', {
          username: this.data.username, smsCode: this.data.smsCode,
        }, { silent: true });
        this.token = result.token;
        clearInterval(this.timer);
        this.setData({ step: 2, smsCode: '', countdown: 0 });
      } else {
        await request('POST', '/auth/phone-change/confirm', {
          username: this.data.username, phone: this.data.phone, smsCode: this.data.smsCode, token: this.token,
        }, { silent: true });
        this.token = '';
        wx.removeStorageSync('user');
        wx.removeStorageSync('sessionToken');
        wx.showModal({ title: '换绑成功', content: '手机号已同步更新，请使用新手机号或原账号密码重新登录。', showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/login/index' }) });
        this.setData({ ready: false });
      }
    } catch (e) { this.error(e); }
    finally { this.setData({ busy: false }); }
  },
});
