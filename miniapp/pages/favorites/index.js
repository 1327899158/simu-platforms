const {request}=require('../../utils/request');
const {ensureLogin}=require('../../utils/auth');
Page({
 toggleManage(){this.setData({managing:!this.data.managing});},
 data:{kind:'ENGINEER',tabs:[{key:'ENGINEER',label:'工程师'},{key:'CASE',label:'案例'},{key:'DEMAND',label:'需求'}],items:[],selected:[],nextOffset:null,busy:false,error:''},
 onShow(){if(ensureLogin())this.load(false);},onPullDownRefresh(){this.load(false).finally(()=>wx.stopPullDownRefresh());},
 async load(more=false){if(this.data.busy)return;const offset=more?this.data.nextOffset:0;if(offset===null)return;this.setData({busy:true,error:''});try{const r=await request('GET','/favorites',{kind:this.data.kind,offset});this.setData({items:more?this.data.items.concat(r.items):r.items,nextOffset:r.nextOffset,selected:[]});}catch(e){this.setData({error:e.message});}finally{this.setData({busy:false});}},
 tab(e){if(this.data.busy)return;this.setData({kind:e.currentTarget.dataset.key,items:[],selected:[]});this.load();},
 choose(e){const selected=e.detail.value;this.setData({selected,items:this.data.items.map(x=>({...x,checked:selected.includes(x.id)}))});},more(){this.load(true);},retry(){this.load();},
 async remove(e){if(this.data.busy)return;const ids=e.currentTarget.dataset.id?[e.currentTarget.dataset.id]:this.data.selected;if(!ids.length)return;if(!await require('../../utils/community').confirm('取消收藏','确认移除选中的收藏？'))return;this.setData({busy:true});try{await request('POST','/favorites/remove',{kind:this.data.kind,ids});}catch(e){wx.showToast({title:e.message,icon:'none'});}finally{this.setData({busy:false});this.load();}},
 open(e){const item=this.data.items.find(x=>x.id===e.currentTarget.dataset.id);if(!item)return;const u=ensureLogin();if(!u)return;let url;if(item.kind==='ENGINEER')url='/pages/engineer-profile/index?id='+item.id;else if(item.kind==='CASE')url='/pages/engineer-profile/index?id='+item.engineerId+'&caseId='+item.id;else{if(u.role!=='ENGINEER'&&item.customerId!==u.id)return wx.showToast({title:'请使用工程师身份查看需求',icon:'none'});url='/pages/order-detail/index?id='+item.id+'&mode='+(u.role==='ENGINEER'?'market':'customer');}wx.navigateTo({url});}
});
