const {request}=require('../../../utils/request'),{loadAdmin,hasPermission,denyAndExit}=require('../../utils/admin');
const {LABELS,yuan,businessKey,fen}=require('../../../utils/demo-wallet');
Page({
 data:{ready:false,items:[],nextOffset:null,busy:false,error:'',userId:'',amount:'',note:''},
 async onLoad(){try{const admin=await loadAdmin();if(!hasPermission(admin,'WALLET_MANAGE'))return denyAndExit('无模拟钱包管理权限');this.setData({ready:true});this.load();}catch(e){denyAndExit(e.message);}},
 onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
 field(e){const key=e.currentTarget.dataset.key;if(['userId','amount','note'].includes(key))this.setData({[key]:e.detail.value});},
 retry(){this.load();},more(){if(this.data.nextOffset!==null)this.load(true);},
 async load(more=false){if(!this.data.ready||this._loading)return;this._loading=true;try{const r=await request('GET','/admin/wallet',{offset:more?this.data.nextOffset:0});const items=r.items.map(x=>({...x,amount:yuan(x.amountFen),label:LABELS[x.status]}));this.setData({items:more?this.data.items.concat(items):items,nextOffset:r.nextOffset,error:''});}catch(e){this.setData({error:e.message});}finally{this._loading=false;}},
 async credit(){if(this.data.busy)return;let amountFen;try{amountFen=fen(this.data.amount);}catch(e){return wx.showToast({title:e.message,icon:'none'});}if(this.data.note.trim().length<2)return wx.showToast({title:'请填写操作说明',icon:'none'});
 if(!await require('../../../utils/community').confirm('模拟入账','向指定工程师增加测试余额，不产生真实资金。'))return;
 this._credit=this._credit||{userId:this.data.userId.trim(),amountFen,note:this.data.note.trim(),businessKey:businessKey()};
 if(this._credit.userId!==this.data.userId.trim()||this._credit.amountFen!==amountFen)return wx.showToast({title:'请先重试原入账并确认结果',icon:'none'});
 this.setData({busy:true});try{await request('POST','/admin/wallet/credit',this._credit);this._credit=null;wx.showToast({title:'模拟入账完成'});}catch(e){if(e.statusCode>=400&&e.statusCode<500)this._credit=null;wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 async process(e){if(this.data.busy)return;const {id,status}=e.currentTarget.dataset;if(this.data.note.trim().length<2)return wx.showToast({title:'请先填写处理说明',icon:'none'});
 if(!await require('../../../utils/community').confirm('更新模拟状态',LABELS[status]+'；只更新测试账本及审计，不调用支付接口。'))return;
 this.setData({busy:true});try{await request('POST','/admin/wallet/'+id,{status,note:this.data.note.trim()});await this.load();}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});}},
 async events(e){try{const rows=await request('GET','/admin/wallet/'+e.currentTarget.dataset.id+'/events');wx.showModal({title:'模拟处理记录',content:rows.map(r=>(LABELS[r.status]||r.status)+' · '+r.note+' · '+r.createdAt).join('\n')||'暂无',showCancel:false});}catch(e){}}
});
