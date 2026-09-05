const {request}=require('../../../utils/request');
Page({data:{items:[],editing:null,actions:['PUBLISH','SHARE','ORDERS'],labels:['发布需求','邀请分享','我的订单'],actionIndex:0,saving:false},
onLoad(){this.load();},async load(){try{this.setData({items:await request('GET','/admin/campaigns')});}catch(_){}},
add(){this.setData({editing:{title:'',subtitle:'',content:'',enabled:true,sortOrder:0},actionIndex:0});},
edit(e){const item=this.data.items.find(x=>x.id===e.currentTarget.dataset.id);this.setData({editing:{...item,enabled:!!item.enabled},actionIndex:this.data.actions.indexOf(item.action)});},
input(e){this.setData({['editing.'+e.currentTarget.dataset.key]:e.detail.value});},
action(e){this.setData({actionIndex:Number(e.detail.value)});},enable(e){this.setData({'editing.enabled':e.detail.value});},
async save(){if(this.data.saving)return;this.setData({saving:true});try{await request('POST','/admin/campaigns',{...this.data.editing,sortOrder:Number(this.data.editing.sortOrder),action:this.data.actions[this.data.actionIndex]});this.setData({editing:null});await this.load();wx.showToast({title:'已保存'});}catch(_){}finally{this.setData({saving:false});}}});
