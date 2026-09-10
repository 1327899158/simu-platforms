const ALL_TABS = Object.freeze([
  { pagePath: '/pages/home/index', text: '首页', icon: '⌂' },
  { pagePath: '/pages/market/index', text: '接单大厅', icon: '▤', engineerOnly: true },
  { pagePath: '/pages/chat-list/index', text: '消息', icon: '✉' },
  { pagePath: '/pages/me/index', text: '我的', icon: '☺' },
]);

Component({
  data: {
    tabs: [], customer:false,
    currentPath: '',
    unreadTotal: 0,
  },
  lifetimes: {
    attached() {
      this.syncTabBar();
    },
  },
  methods: {
    syncTabBar(role, currentPath) {
      const user = wx.getStorageSync('user') || {};
      const currentRole = role || user.role || 'CUSTOMER';
      const pages = getCurrentPages();
      const activePage = pages.length ? `/${pages[pages.length - 1].route}` : '';
      this.setData({
        customer:currentRole==='CUSTOMER',
        tabs: currentRole==='CUSTOMER' ? [ALL_TABS[0],{pagePath:'/pages/orders/index',text:'订单',icon:'📋',navigate:true},{pagePath:'publish',text:'发布需求',publish:true},ALL_TABS[2],ALL_TABS[3]] : ALL_TABS.filter((tab) => !tab.engineerOnly || currentRole === 'ENGINEER'),
        currentPath: currentPath || activePage,
        unreadTotal: Number((getApp().globalData || {}).unreadTotal || 0),
      });
    },
    setUnreadTotal(total) {
      this.setData({ unreadTotal: Number(total || 0) });
    },
    switchTab(e) {
      const path = e.currentTarget.dataset.path;
      if(path==='publish'){
        const user=wx.getStorageSync('user')||{};
        if(user.role!=='CUSTOMER')return;
        const identity=require('../utils/identity');
        if(!identity.isApproved(user))return identity.promptIdentity('发布需求');
        return wx.navigateTo({url:'/pages/publish/index'});
      }
      if(path==='/pages/orders/index')return wx.navigateTo({url:path});
      if (!path || path === this.data.currentPath) return;
      wx.switchTab({ url: path });
    },
  },
});
