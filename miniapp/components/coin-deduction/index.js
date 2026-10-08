const {request}=require('../../utils/request');
Component({
 properties:{amountFen:{type:Number,value:0},locked:{type:Boolean,value:false},heldCoins:{type:Number,value:0},busy:{type:Boolean,value:false}},
 data:{balance:0,maxCoins:0,selected:false,coins:0,deductionText:'0.00',error:''},
 observers:{'amountFen,locked,heldCoins,busy'(){this.update();}},
 lifetimes:{attached(){this.load();}},pageLifetimes:{show(){this.load();}},
 methods:{
  reset(){this.setData({selected:false});this._reported=undefined;this.update();},
  async load(){if(this._loading)return;this._loading=true;try{const t=await request('GET','/benefits/balance',null,{silent:true});this.setData({balance:t.balance,error:''});this.update();}catch(_){this.setData({error:'仿真币余额读取失败，点击重试'});}finally{this._loading=false;}},
  update(){const maxCoins=Math.max(0,Math.min(Number(this.data.balance||0),Number(this.data.amountFen||0))),coins=this.data.locked||this.data.busy?Number(this.data.heldCoins||0):this.data.selected?maxCoins:0;this.setData({maxCoins,coins,deductionText:(coins/100).toFixed(2)});if(!this.data.locked&&!this.data.busy&&this._reported!==coins){this._reported=coins;this.triggerEvent('change',{coins});}},
  toggle(e){if(this.data.locked||this.data.busy)return;this.setData({selected:!!e.detail.value});this.update();}
 }
});
