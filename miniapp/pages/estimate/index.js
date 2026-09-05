const {request}=require('../../utils/request');
Page({
 data:{types:['结构强度','流体CFD','电磁兼容','热仿真','振动噪声','多物理场耦合','复合材料','其他'],scales:[{name:'简单',desc:'常规模型/标准工况'},{name:'标准',desc:'中等复杂度/多工况'},{name:'复杂',desc:'精细模型/多物理场/反复迭代'}],type:'结构强度',complexity:'标准',urgent:false,result:null},
 onLoad(){this.calculate();},
 choose(e){this.setData({[e.currentTarget.dataset.key]:e.currentTarget.dataset.value},()=>this.calculate());},
 urgent(e){this.setData({urgent:e.detail.value},()=>this.calculate());},
 async calculate(){const seq=this._seq=(this._seq||0)+1;this.setData({result:null});try{const result=await request('POST','/home/estimate',{type:this.data.type,complexity:this.data.complexity,urgent:this.data.urgent});if(seq===this._seq)this.setData({result});}catch(_){}},
 publish(){const r=this.data.result;if(!r)return;wx.navigateTo({url:'/pages/publish/index?estimateBudget='+Math.round((r.low+r.high)/2)+'&estimateDirection='+encodeURIComponent(r.direction)});}
});
