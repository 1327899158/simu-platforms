const { request } = require('../../../utils/request');
const { loadAdmin, hasPermission, exitAdmin, denyAndExit } = require('../../utils/admin');

Page({
  data: { admin: null, stats: null, loading: true, menus: [] },
  onLoad() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  async load() {
    this.setData({ loading: true });
    try {
      const admin = await loadAdmin();
      const stats = await request('GET', '/admin/dashboard', null, { silent: true });
      const definitions = [
        {key:'wallet',title:'模拟钱包与提现',desc:'测试入账、冻结、审核和模拟打款',path:'/admin/pages/wallet/index',permission:'WALLET_MANAGE'},
        {key:'help',title:'帮助内容管理',desc:'FAQ、帮助与关于我们',path:'/admin/pages/help/index',permission:'HELP_MANAGE'},
        {key:'support',title:'反馈与举报处理',desc:'受理、调查、处理及审计',path:'/admin/pages/support/index',permission:'SUPPORT_MANAGE'},
        { key:'campaigns',title:'首页活动管理',desc:'编辑轮播与活动规则',path:'/admin/pages/campaigns/index',permission:'CAMPAIGN_MANAGE' },
        { key: 'users', title: '用户管理', desc: '查看账号与状态', path: '/admin/pages/users/index', permission: 'USER_READ' },
        { key: 'engineers', title: '身份认证审核', desc: '审核用户身份认证', path: '/admin/pages/engineers/index', permission: 'ENGINEER_READ', count: stats.engineerReviews.pending },
        { key: 'orders', title: '订单管理', desc: '查看平台全部订单', path: '/admin/pages/orders/index', permission: 'ORDER_READ' },
        { key: 'invoices', title: '发票管理', desc: '预览客户申请与处理状态', path: '/admin/pages/invoices/index', permission: 'INVOICE_READ' },
        { key: 'disputes', title: '纠纷管理', desc: '处理订单履约纠纷', path: '/admin/pages/disputes/index', permission: 'DISPUTE_READ' },
        { key: 'preview', title: '数据预览', desc: '查看趋势、分布与评分', path: '/admin/pages/data-preview/index', permission: 'DASHBOARD_READ' },
        { key: 'audit', title: '操作日志', desc: '追踪敏感管理操作', path: '/admin/pages/audit-logs/index', permission: 'AUDIT_READ' },
      ];
      this.setData({ admin, stats, menus: definitions.filter((item) => hasPermission(admin, item.permission)) });
    } catch (error) {
      denyAndExit(error.message);
    } finally {
      this.setData({ loading: false });
    }
  },
  open(e) { wx.navigateTo({ url: e.currentTarget.dataset.path }); },
  exit() { exitAdmin(); },
});
