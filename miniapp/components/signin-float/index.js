// 保持组件自包含，避免增量发布遗漏位置工具文件导致整个浮窗加载失败。
function snapPosition(width,height,pos={}) {
 const right=Math.max(0,width-84),left=Math.min(8,right);
 const x=Number.isFinite(Number(pos.x))?Number(pos.x):right;
 const y=Number.isFinite(Number(pos.y))?Number(pos.y):height-80;
 return {x:x-left<right-x?left:right,y:Math.max(0,Math.min(height-66,y))};
}
Component({
 data:{width:320,height:500,x:220,y:350},
 lifetimes:{attached(){this.restore();}},
 pageLifetimes:{show(){this.restore();},resize(){this.restore();}},
 methods:{
  restore(){
    let info={},saved={};
    try{info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync();saved=wx.getStorageSync('signin-float-position')||{};}catch(_){ /* 使用可见的默认位置 */ }
    const width=Number(info.windowWidth)>0?Number(info.windowWidth):320;
    const height=Math.max(180,(Number(info.windowHeight)>0?Number(info.windowHeight):600)-100);
    const pos=snapPosition(width,height,saved);this._pos=pos;this.setData({width,height,...pos});
  },
  start(e){this._start=e.touches[0];this._origin=this.data?{x:this.data.x,y:this.data.y}:null;this._dragged=false;},
  move(e){if(this._start&&e.touches[0]){const t=e.touches[0],dx=t.clientX-this._start.clientX,dy=t.clientY-this._start.clientY;if(Math.abs(dx)+Math.abs(dy)>8)this._dragged=true;
    if(this._dragged&&this._origin){this._pos={x:Math.max(0,Math.min(this.data.width-76,this._origin.x+dx)),y:Math.max(0,Math.min(this.data.height-66,this._origin.y+dy))};this.setData(this._pos);}
  }},
  change(e){this._pos={x:e.detail.x,y:e.detail.y};},
  end(){if(this._dragged){this._ignoreUntil=Date.now()+350;if(this._pos){const pos=snapPosition(this.data.width,this.data.height,this._pos);wx.setStorageSync('signin-float-position',pos);
    this._pos=pos;this.setData(pos);
  }}this._start=null;},
  open(){if(Date.now()<(this._ignoreUntil||0))return;wx.navigateTo({url:'/pages/incentives/index'});}
 }
});
