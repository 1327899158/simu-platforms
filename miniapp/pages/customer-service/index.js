const {ensureLogin}=require('../../utils/auth');Page({onShow(){ensureLogin();}});
