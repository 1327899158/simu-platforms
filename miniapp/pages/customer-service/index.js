const {ensureLogin}=require('../../utils/auth');Page({data:{orderId:''},onLoad(q){this.setData({orderId:q.orderId||''});},onShow(){ensureLogin();}});
