const {request}=require('../../utils/request');const {ensureLogin}=require('../../utils/auth');
const badges={FIRST:{title:'初露锋芒',icon:'rocket'},TEN:{title:'十单达人',icon:'award'},WEEK_THREE:{title:'本周先锋',icon:'chart'},STREAK_THREE:{title:'连续交付',icon:'flame'}};
Page({
 data:{info:null,busy:false,error:'',user:null},
 onShow(){const user=ensureLogin();if(!user)return;this.setData({user});this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 async load(){try{const info=await request('GET','/incentives');
  info.tasks=info.tasks.map(t=>({...t,...badges[t.key],taskTitle:t.title,showing:info.badges.some(b=>b.key===t.key)}));
  const rank=info.leaderboard.findIndex(x=>x.id===this.data.user.id);info.rank=rank>=0?String(rank+1):'未入前20';
  this.setData({info,error:''});
 }catch(e){this.setData({error:e.message});}},
 async action(path,data,message){if(this.data.busy)return;this.setData({busy:true});try{const result=await request('POST',path,data);wx.showToast({title:result.duplicate?'今日或本项已领取':message,icon:'none'});await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 claim(e){this.action('/incentives/claim',{key:e.currentTarget.dataset.key},'奖励已存入仿真币');},
 signin(){this.action('/incentives/signin',{},'签到成功 +8币');},
 showcase(e){this.action('/incentives/showcase',{key:e.currentTarget.dataset.key,enabled:!e.currentTarget.dataset.showing},'主页展示已更新');},
 assets(){wx.navigateTo({url:'/pages/benefits/index'});},
 level(){wx.navigateTo({url:'/pages/engineer-level/index'});}
});
