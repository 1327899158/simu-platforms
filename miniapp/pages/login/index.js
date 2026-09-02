/**
 * 登录页（云开发版 + 多种登录方式）。
 * 微信登录流程：wx.login 静默登录 → 检测昵称 → 无则弹资料完善卡片
 */
const {
  login, loginByUsername, registerByPhone, loginByPhone,
  requestSmsCode, isLoggedIn, logout, saveUser
} = require('../../utils/auth');
const { request, upload } = require('../../utils/request');
const { digits } = require('../../utils/input');

Page({
  data: {
    // 默认进入一键登录首页；手机号、账号密码作为次级入口。
    tab: 'wechat',
    phoneStep: 'phone', // phone | code | account
    role: '',
    roleText: '',
    loading: false,
    agreementAccepted: false,

    // 账号密码
    isRegister: false,
    username: '',
    password: '',
    passwordConfirm: '',

    // 手机验证码
    phone: '',
    smsCode: '',
    smsCountdown: 0,
    smsSending: false,

    // 资料完善（任一登录方式首次建档、尚未设置昵称时显示）
    needProfile: false,
    tempAvatarPath: '',   // chooseAvatar 返回的临时路径
    nickname: '',
    profileReviewPending: false,
    profileSuccessTitle: '登录成功',
  },

  onLoad() {
    if (isLoggedIn()) wx.switchTab({ url: '/pages/home/index' });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      tab,
      phoneStep: 'phone',
      role: '',
      username: '',
      password: '',
      passwordConfirm: '',
      phone: '',
      smsCode: '',
      needProfile: false,
    });
  },

  // ========== 用户协议与隐私政策 ==========
  confirmAgreement() {
    if (this.data.agreementAccepted) return Promise.resolve(true);
    if (this._agreementDialogOpen) return Promise.resolve(false);

    this._agreementDialogOpen = true;
    return new Promise((resolve) => {
      wx.showModal({
        title: '用户协议及隐私政策',
        content: '请阅读并同意《平台服务协议》和《隐私政策》。平台将为登录、身份认证、交易履约和账号安全处理必要信息。',
        confirmText: '同意',
        cancelText: '不同意',
        confirmColor: '#2FA8DE',
        success: (result) => {
          if (result.confirm) {
            this.setData({ agreementAccepted: true });
            resolve(true);
          } else {
            resolve(false);
          }
        },
        fail: (error) => {
          console.error('[login] agreement modal failed', error);
          wx.showToast({ title: '协议弹窗打开失败，请重试', icon: 'none' });
          resolve(false);
        },
        complete: () => { this._agreementDialogOpen = false; },
      });
    });
  },

  showAgreementDialog() {
    return this.confirmAgreement();
  },

  showPendingReviewAndEnter(title = '登录成功') {
    const enterHome = () => wx.switchTab({ url: '/pages/home/index' });
    wx.showModal({
      title,
      content: '请进行身份认证，审核通过后即可使用完整功能。',
      showCancel: false,
      confirmText: '确定',
      success: (result) => {
        if (result.confirm) enterHome();
      },
      fail: enterHome,
    });
  },

  needsProfile(user) {
    const nickname = String((user && user.nickname) || '').trim();
    return !nickname || nickname === '仿真客户' || nickname === '仿真工程师';
  },

  handleAuthenticatedUser(user, successTitle = '登录成功') {
    this.setData({ loading: false });
    if (this.needsProfile(user)) {
      this.setData({
        needProfile: true,
        tempAvatarPath: '',
        nickname: '',
        profileReviewPending: !!(user && user.verifyStatus === 'PENDING'),
        profileSuccessTitle: successTitle,
      });
      wx.showToast({ title: '请完善资料', icon: 'none' });
      return;
    }
    if (user && user.verifyStatus === 'PENDING') {
      this.showPendingReviewAndEnter(successTitle);
      return;
    }
    wx.showToast({ title: successTitle, icon: 'success' });
    setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 800);
  },

  finishProfileSetup(successMessage) {
    if (this.data.profileReviewPending) {
      this.showPendingReviewAndEnter(this.data.profileSuccessTitle || '登录成功');
      return;
    }
    wx.showToast({ title: successMessage, icon: 'success' });
    setTimeout(() => wx.switchTab({ url: '/pages/home/index' }), 500);
  },

  // ========== 微信登录 ==========
  async wxLogin() {
    if (!this.data.role) {
      return wx.showToast({ title: '请先选择身份', icon: 'none' });
    }
    if (!(await this.confirmAgreement())) return;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '登录中…', mask: true });
      const user = await login(this.data.role);
      wx.hideLoading();
      this.handleAuthenticatedUser(user, '登录成功');
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '登录失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  selectRole(e) {
    const role = e.currentTarget.dataset.role;
    this.setData({
      role,
      roleText: role === 'engineer' ? '工程师' : '客户',
    });
  },

  // ========== 资料完善（chooseAvatar + nickname） ==========
  onChooseAvatar(e) {
    const tempPath = e.detail.avatarUrl;
    this.setData({ tempAvatarPath: tempPath });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value });
  },

  async saveProfile() {
    if (!this.data.nickname || !this.data.nickname.trim()) {
      return wx.showToast({ title: '请输入昵称', icon: 'none' });
    }
    if (!this.data.tempAvatarPath) {
      return wx.showToast({ title: '请选择头像', icon: 'none' });
    }
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '保存中…', mask: true });
      // 1. 上传头像到云存储
      const uploadResult = await upload(this.data.tempAvatarPath, { kind: 'IMAGE', name: 'avatar.jpg' });
      // 2. 更新用户资料
      const updated = await request('PATCH', '/me', {
        nickname: this.data.nickname.trim(),
        avatarUrl: uploadResult.fileID,
      });
      saveUser(updated);
      wx.hideLoading();
      this.finishProfileSetup('资料已保存');
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  skipProfile() {
    this.finishProfileSetup(this.data.profileSuccessTitle || '登录成功');
  },

  // ========== 账号密码 ==========
  toggleRegister(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === 'register') {
      this.setData({ isRegister: true, username: '', password: '', passwordConfirm: '' });
    } else {
      this.setData({ isRegister: false, username: '', password: '', passwordConfirm: '' });
    }
  },

  async accountLogin() {
    if (!this.data.username) return wx.showToast({ title: '请输入用户名', icon: 'none' });
    if (!this.data.password) return wx.showToast({ title: '请输入密码', icon: 'none' });
    if (!(await this.confirmAgreement())) return;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '登录中…', mask: true });
      const loggedIn = await loginByUsername(this.data.username, this.data.password);
      wx.hideLoading();
      this.handleAuthenticatedUser(loggedIn, '登录成功');
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '登录失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  async accountRegister() {
    if (!this.data.username) return wx.showToast({ title: '请输入用户名（6-12位数字）', icon: 'none' });
    if (!/^\d{6,12}$/.test(this.data.username)) return wx.showToast({ title: '用户名只能是6-12位数字', icon: 'none' });
    if (!this.data.phone) return wx.showToast({ title: '请输入手机号', icon: 'none' });
    if (!/^\d{11}$/.test(this.data.phone)) return wx.showToast({ title: '手机号格式不对', icon: 'none' });
    if (!this.data.password) return wx.showToast({ title: '请输入密码（至少6位）', icon: 'none' });
    if (this.data.password.length < 6) return wx.showToast({ title: '密码至少6位', icon: 'none' });
    if (this.data.password !== this.data.passwordConfirm) return wx.showToast({ title: '两次密码不一致', icon: 'none' });
    if (!this.data.smsCode) return wx.showToast({ title: '请输入验证码', icon: 'none' });
    if (!/^\d{6}$/.test(this.data.smsCode)) return wx.showToast({ title: '验证码格式不对', icon: 'none' });
    if (!(await this.confirmAgreement())) return;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '注册中…', mask: true });
      const registered = await registerByPhone(this.data.username, this.data.phone, this.data.password, this.data.smsCode, this.data.role || 'customer');
      wx.hideLoading();
      this.handleAuthenticatedUser(registered, '注册成功');
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '注册失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  goResetPassword() {
    const query = this.data.username ? `?username=${encodeURIComponent(this.data.username)}` : '';
    wx.navigateTo({ url: `/pages/reset-password/index${query}` });
  },

  // ========== 手机验证码 ==========
  async phoneRequestSms(type) {
    if (!this.data.phone) {
      wx.showToast({ title: '请输入手机号', icon: 'none' });
      return false;
    }
    if (!/^\d{11}$/.test(this.data.phone)) {
      wx.showToast({ title: '手机号格式不对', icon: 'none' });
      return false;
    }
    if (!(await this.confirmAgreement())) return false;
    if (this.data.smsCountdown > 0) return false;
    const smsType = typeof type === 'string'
      ? type
      : (this.data.phoneStep === 'account' && this.data.isRegister ? 'REGISTER' : 'LOGIN');
    this.setData({ smsSending: true });
    try {
      const result = await requestSmsCode(this.data.phone, smsType);
      wx.showToast({ title: '验证码已发送', icon: 'success' });
      this.setData({ smsCountdown: result.nextRetry || 60 });
      const timer = setInterval(() => {
        if (this.data.smsCountdown <= 0) {
          clearInterval(timer);
          this.setData({ smsCountdown: 0 });
        } else {
          this.setData({ smsCountdown: this.data.smsCountdown - 1 });
        }
      }, 1000);
      return true;
    } catch (e) {
      wx.showToast({ title: e.message || '发送失败', icon: 'none' });
      return false;
    } finally {
      this.setData({ smsSending: false });
    }
  },

  async proceedPhoneLogin() {
    const sent = await this.phoneRequestSms('LOGIN');
    if (sent) this.setData({ phoneStep: 'code', smsCode: '' });
  },

  switchPhoneStep() {
    this.setData({ phoneStep: 'phone', smsCode: '' });
  },

  switchAccountLogin() {
    this.setData({ phoneStep: 'account', isRegister: false, password: '', passwordConfirm: '', smsCode: '' });
  },

  switchPhoneLogin() {
    this.setData({ phoneStep: 'phone', isRegister: false, password: '', passwordConfirm: '', smsCode: '' });
  },

  goGuestMarket() {
    wx.navigateTo({ url: '/pages/guest-market/index' });
  },

  async phoneLogin() {
    if (!this.data.phone) return wx.showToast({ title: '请输入手机号', icon: 'none' });
    if (!this.data.smsCode) return wx.showToast({ title: '请输入验证码', icon: 'none' });
    if (!(await this.confirmAgreement())) return;
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      wx.showLoading({ title: '登录中…', mask: true });
      const loggedIn = await loginByPhone(this.data.phone, this.data.smsCode, this.data.role || 'customer');
      wx.hideLoading();
      this.handleAuthenticatedUser(loggedIn, '登录成功');
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message || '登录失败', icon: 'none' });
    }
    this.setData({ loading: false });
  },

  // ========== 输入事件 ==========
  onUsername(e) {
    const value = digits(e.detail.value, 12);
    this.setData({ username: value });
    return value;
  },
  onPassword(e) { this.setData({ password: e.detail.value }); },
  onPasswordConfirm(e) { this.setData({ passwordConfirm: e.detail.value }); },
  onPhone(e) {
    const value = digits(e.detail.value, 11);
    this.setData({ phone: value });
    return value;
  },
  onSmsCode(e) {
    const value = digits(e.detail.value, 6);
    this.setData({ smsCode: value });
    return value;
  },
});
