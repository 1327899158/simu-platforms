const {request}=require('../../utils/request'),{ensureLogin}=require('../../utils/auth');
Page({
 data:{info:null,user:null,qrPath:'',qrError:'',error:'',busy:false},
 onShow(){const user=ensureLogin();if(!user)return;this.setData({user});this.load();},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 async load(){try{this.setData({info:await request('GET','/invitations'),error:''});this.loadQr();}catch(e){this.setData({error:e.message||'邀请信息读取失败'});}},
 async loadQr(){if(this._qrLoading||this.data.qrPath)return this.data.qrPath;this._qrLoading=true;try{
  const qr=await request('GET','/invitations/qr',null,{silent:true}),filePath=wx.env.USER_DATA_PATH+'/invite-'+this.data.info.code+(qr.mime==='image/jpeg'?'.jpg':'.png');
  await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:qr.image,encoding:'base64',success:resolve,fail:reject}));
  this.setData({qrPath:filePath,qrError:''});return filePath;
 }catch(e){this.setData({qrError:e.message||'小程序码读取失败，点击重试'});return '';}finally{this._qrLoading=false;}},
 async album(filePath){try{await new Promise((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:resolve,fail:reject}));wx.showToast({title:'已保存到相册'});}catch(e){if(/auth|authorize|denied/.test(e.errMsg||''))wx.showModal({title:'需要相册权限',content:'请在设置中允许保存图片，然后重试。',confirmText:'去设置',success:r=>{if(r.confirm)wx.openSetting({});}});else if(!String(e.errMsg||'').includes('cancel'))wx.showToast({title:'保存失败，请重试',icon:'none'});}},
 async saveQr(){if(this.data.busy)return;const file=this.data.qrPath||await this.loadQr();if(file)await this.album(file);},
 async copyLink(){if(this.data.busy)return;this.setData({busy:true});try{const r=await request('POST','/invitations/link',{});await new Promise((resolve,reject)=>wx.setClipboardData({data:r.url,success:resolve,fail:reject}));}catch(e){wx.showToast({title:e.message||'个人链接生成失败',icon:'none'});}finally{this.setData({busy:false});}},
 onShareAppMessage(){return {title:'邀请你加入仿真服务平台，寻找专业工程师',path:this.data.info?.sharePath||'/pages/guest-home/index'};},
 async savePoster(){if(this.data.busy)return;this.setData({busy:true});try{
  const qr=this.data.qrPath||await this.loadQr();if(!qr)return;
  const c=wx.createCanvasContext('invite-poster',this),g=c.createLinearGradient(0,0,560,450);g.addColorStop(0,'#4f6bff');g.addColorStop(1,'#8b5cff');c.setFillStyle('#fff');c.fillRect(0,0,560,920);c.setFillStyle(g);c.fillRect(0,0,560,440);
  c.setFillStyle('rgba(255,255,255,0.12)');c.beginPath();c.arc(520,50,120,0,Math.PI*2);c.fill();c.beginPath();c.arc(30,425,130,0,Math.PI*2);c.fill();
  c.setTextAlign('center');c.setFillStyle('#fff');c.setFontSize(60);c.fillText('仿',280,105);c.setFontSize(24);c.fillText('仿真通 · 邀请有礼',280,160);c.setFontSize(34);c.fillText('好友注册得50仿真币',280,233);c.fillText('首单完成再得250仿真币',280,286);c.setFontSize(22);c.fillText('来自 '+String(this.data.user.nickname||'仿真用户').slice(0,16)+' 的邀请',280,350);c.setFontSize(20);c.fillText('专属邀请码 '+this.data.info.code,280,395);
  c.setFillStyle('#476777');c.setFontSize(24);c.fillText('长按识别小程序码，加入仿真服务平台',280,490);c.drawImage(qr,140,522,280,280);c.setFontSize(20);c.fillText('100仿真币 = 1元站内抵扣',280,849);c.setFontSize(17);c.setFillStyle('#8994a8');c.fillText('邀请新用户注册 · 首笔订单完成后追加奖励',280,887);
  await new Promise(resolve=>c.draw(false,resolve));const image=await new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvasId:'invite-poster',width:560,height:920,destWidth:1120,destHeight:1840,fileType:'png',success:resolve,fail:reject},this));await this.album(image.tempFilePath);
 }catch(e){wx.showToast({title:e.message||'海报保存失败，请重试',icon:'none'});}finally{this.setData({busy:false});}}
});
