'use strict';
const {query,tx}=require('../db');
const {ensureConversation,systemMessage,publishConversationDoc,publishSystemMessage}=require('./chat-svc');
const {refreshForOrder}=require('./engineer-level');
const {deadline,AUTO_COMPLETE_DAYS}=require('./acceptance-policy');
function reminderStage(order,now=Date.now()){
 const end=deadline(order);
 if(!end)return null;
 const remaining=new Date(end).getTime()-now;
 if(remaining<=0||remaining>3*86400000)return null;
 return remaining<=86400000?'ACCEPT_1D':'ACCEPT_3D';
}
async function remind(id){
 const result=await tx(async c=>{
  const [[order]]=await c.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[id]);
  if(!order||order.deletedAt||order.completedAt)return null;
  const kind=reminderStage(order);
  if(!kind)return null;
  const [[dispute]]=await c.execute("SELECT id FROM disputes WHERE orderId=? AND status='OPEN' LIMIT 1",[id]);
  const [[refund]]=await c.execute("SELECT id FROM refund_requests WHERE orderId=? AND status IN ('PENDING','AGREED') LIMIT 1",[id]);
  if(dispute||refund)return null;
  const end=new Date(deadline(order));
  // 按本次交付的截止时间去重，重新交付后可重新提醒。
  const [inserted]=await c.execute('INSERT IGNORE INTO delivery_reminders(orderId,deadline,kind,createdAt) VALUES(?,?,?,UTC_TIMESTAMP(3))',[id,end,kind]);
  if(!inserted.affectedRows)return null;
  const conv=await ensureConversation(id,c);
  const content=`自动收货提醒：订单将在${kind==='ACCEPT_1D'?'1天':'3天'}内自动确认收货，请及时查收工程师成果并验收。如有问题，请在到期前发起售后。点击查看订单。`;
  // SYSTEM 样式仍保持系统提示；使用对方ID使现有未读机制仅提醒客户。
  const meta={senderId:conv.engineerId,actionOrderId:id};
  const message=await systemMessage(conv.id,content,c,meta);
  return {conv,content,message,meta};
 });
 if(!result)return false;
 if(result.conv._isNew)publishConversationDoc(result.conv);
 publishSystemMessage(result.conv.id,result.content,result.message.msgId,result.meta);
 return true;
}
async function complete(id){
 const result=await tx(async c=>{
  const [[order]]=await c.execute('SELECT * FROM orders WHERE id=? FOR UPDATE',[id]);
  if(!order||order.deletedAt||order.completedAt||!deadline(order))return null;
  const [[dispute]]=await c.execute("SELECT id FROM disputes WHERE orderId=? AND status='OPEN' LIMIT 1",[id]);
  const [[refund]]=await c.execute("SELECT id FROM refund_requests WHERE orderId=? AND status IN ('PENDING','AGREED') LIMIT 1",[id]);
  if(dispute||refund)return null;
  const [r]=await c.execute("UPDATE orders SET status='COMPLETED',completedAt=UTC_TIMESTAMP(3),updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND status='DELIVERED' AND completedAt IS NULL AND deletedAt IS NULL AND deliveredAt<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 14 DAY)",[id]);
  if(!r.affectedRows)return null;
  const conv=await ensureConversation(id,c);
  const content='交付已满14天，客户未确认验收，系统已自动确认收货，订单完成。';
  const message=await systemMessage(conv.id,content,c);
  return {conv,content,message};
 });
 if(!result)return false;
 if(result.conv._isNew)publishConversationDoc(result.conv);
 publishSystemMessage(result.conv.id,result.content,result.message.msgId);
 await refreshForOrder(id);
 return true;
}
let timer=null,busy=false;
async function run(){
 if(busy)return;busy=true;
 try{
  const pending=await query("SELECT id FROM orders WHERE status='DELIVERED' AND completedAt IS NULL AND deletedAt IS NULL AND deliveredAt<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 11 DAY) AND deliveredAt>DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 14 DAY)");
  for(const row of pending)try{await remind(row.id);}catch(e){console.error('[auto-complete/reminder]',row.id,e.message);}
  const rows=await query("SELECT id FROM orders WHERE status='DELIVERED' AND completedAt IS NULL AND deletedAt IS NULL AND deliveredAt<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 14 DAY)");
  for(const row of rows)try{await complete(row.id);}catch(e){console.error('[auto-complete/order]',row.id,e.message);}
 }finally{busy=false;}
}
function startAutoComplete(){if(timer)return;const tick=()=>run().catch(e=>console.error('[auto-complete]',e.message));tick();timer=setInterval(tick,60000);timer.unref?.();}
function stop(){clearInterval(timer);timer=null;}
module.exports={run,complete,remind,reminderStage,deadline,AUTO_COMPLETE_DAYS,startAutoComplete,stop};
