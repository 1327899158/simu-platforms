const {snapPosition}=require('../../utils/signin-position');
Component({
 data:{width:320,height:500,x:220,y:350},
 lifetimes:{attached(){const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();const width=info.windowWidth,height=Math.max(180,info.windowHeight-100);const saved=wx.getStorageSync('signin-float-position')||{};const pos=snapPosition(width,height,saved);this._pos=pos;this.setData({width,height,...pos});}},
 methods:{
  start(e){this._start=e.touches[0];this._dragged=false;},
  move(e){if(this._start&&e.touches[0]){const t=e.touches[0];if(Math.abs(t.clientX-this._start.clientX)+Math.abs(t.clientY-this._start.clientY)>8)this._dragged=true;}},
  change(e){this._pos={x:e.detail.x,y:e.detail.y};},
  end(){if(this._dragged){this._ignoreUntil=Date.now()+350;if(this._pos){const pos=snapPosition(this.data.width,this.data.height,this._pos);wx.setStorageSync('signin-float-position',pos);
    // 先同步实际拖拽坐标，再吸附；即使目标与上次绑定值相同也能触发移动。
    this.setData({...this._pos},()=>this.setData(pos));
  }}this._start=null;},
  open(){if(Date.now()<(this._ignoreUntil||0))return;wx.navigateTo({url:'/pages/incentives/index'});}
 }
});
