Component({
 data:{width:320,height:500,x:220,y:350},
 lifetimes:{attached(){const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();const width=info.windowWidth,height=Math.max(180,info.windowHeight-100);const saved=wx.getStorageSync('signin-float-position')||{};this.setData({width,height,x:Math.max(0,Math.min(width-80,saved.x==null?width-84:saved.x)),y:Math.max(0,Math.min(height-70,saved.y==null?height-80:saved.y))});}},
 methods:{
  start(e){this._start=e.touches[0];this._dragged=false;},
  move(e){if(this._start&&e.touches[0]){const t=e.touches[0];if(Math.abs(t.clientX-this._start.clientX)+Math.abs(t.clientY-this._start.clientY)>8)this._dragged=true;}},
  change(e){this._pos={x:e.detail.x,y:e.detail.y};},
  end(){if(this._dragged){this._ignoreUntil=Date.now()+350;if(this._pos)wx.setStorageSync('signin-float-position',this._pos);}},
  open(){if(Date.now()<(this._ignoreUntil||0))return;wx.navigateTo({url:'/pages/incentives/index'});}
 }
});
