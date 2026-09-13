// 与悬浮窗76×66px保持一致。以中心距判断最近边缘，预留8px边距。
function snapPosition(width,height,pos={}) {
 const right=Math.max(0,width-76-8),left=Math.min(8,right);
 const rawX=Number(pos.x),rawY=Number(pos.y);
 const x=Number.isFinite(rawX)?Math.max(left,Math.min(right,rawX)):right;
 const y=Number.isFinite(rawY)?rawY:height-80;
 return {x:x-left<right-x?left:right,y:Math.max(0,Math.min(Math.max(0,height-66),y))};
}
module.exports={snapPosition};
