'use strict';
const {query,tx}=require('../db');
const {err}=require('../lib/http');
const {newId}=require('../lib/util');
const {initialDeadline,authorize}=require('./delivery-svc');
const HOURS48=48*3600000;
function eligible(o,deadline,pending,now=Date.now()) {
 return o.status==='IN_PROGRESS'&&!o.deliveredAt&&!pending&&Number.isFinite(new Date(deadline).getTime())&&now-new Date(deadline).getTime()>=HOURS48;
}
async function inspect(id,user=null,nudge=false){
 const pushes=[];
 const result=await tx(async c=>{
  const [[o]]=await c.execute('SELECT o.*,q.engineerId,q.days FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=? FOR UPDATE',[id]);
  if(user)authorize(o,user);else if(!o||o.deletedAt)return null;
  if(!o.paidAt||!o.engineerId)return null;
  await c.execute('INSERT IGNORE INTO order_delivery_terms(orderId,deadline,updatedAt) VALUES(?,?,UTC_TIMESTAMP(3))',[id,initialDeadline(o)]);
  const [[term]]=await c.execute('SELECT * FROM order_delivery_terms WHERE orderId=? FOR UPDATE',[id]);
  const [[pending]]=await c.execute("SELECT id FROM delivery_extensions WHERE orderId=? AND status='PENDING' LIMIT 1",[id]);
  const isOverdue=o.status==='IN_PROGRESS'&&Date.now()>new Date(term.deadline).getTime();
  async function message(content){const chat=require('./chat-svc'),conv=await chat.ensureConversation(id,c);const msg=await chat.systemMessage(conv.id,content,c,{actionOrderId:id});pushes.push({conv,content,msg});}
  async function remind(kind,content){const [r]=await c.execute('INSERT IGNORE INTO delivery_reminders(orderId,deadline,kind,createdAt) VALUES(?,?,?,UTC_TIMESTAMP(3))',[id,term.deadline,kind]);if(r.affectedRows)await message(content);}
  if(nudge){if(!user||user.id!==o.customerId||user.role!=='CUSTOMER')throw err.forbidden('仅客户可催单');if(!isOverdue)throw err.conflict('当前订单无需逾期催单');await remind('NUDGE','客户已催单：订单逾期未交付，请工程师尽快交付或申请延期。');}
  if(isOverdue)await remind('OVERDUE','订单已逾期未交付。逾期不会自动延期，请工程师尽快交付或申请延期，客户可催单或申请售后。');
  const [[existing]]=await c.execute('SELECT b.disputeId,d.refundStatus FROM delivery_breaches b JOIN disputes d ON d.id=b.disputeId WHERE b.orderId=?',[id]);
  let breach=existing||null;
  if(!breach&&eligible(o,term.deadline,!!pending)){
   const [[blocking]]=await c.execute("SELECT id FROM disputes WHERE orderId=? AND (status='OPEN' OR refundStatus IN ('PENDING','PROCESSED','FAILED')) LIMIT 1",[id]);
   const [[refund]]=await c.execute("SELECT id FROM refund_requests WHERE orderId=? AND status IN ('PENDING','AGREED') LIMIT 1",[id]);
   const [[payment]]=await c.execute("SELECT id FROM payments WHERE orderId=? AND status='SUCCESS' AND amountFen=? LIMIT 1",[id,o.finalAmountFen]);
   if(!blocking&&!refund&&payment&&Number(o.finalAmountFen)>0){
    const disputeId=newId(),note='系统逾期判定：超过约定期限48小时仍未交付，且无待审批延期申请。延期被拒不重置计时。已登记全额待退款，由管理员核实处理，未调用真实退款通道。';
    await c.execute("INSERT INTO disputes(id,orderId,initiatorId,reasonType,description,status,orderStatusAtOpen,evidenceDeadlineAt,refundAmountFen,refundStatus,verdict,orderAction,resolutionNote,resolvedAt,createdAt,updatedAt) VALUES(?,?,?,'DELAY',?,'RESOLVED','IN_PROGRESS',UTC_TIMESTAMP(3),?,'PENDING','CUSTOMER_FAVOR','CLOSE',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[disputeId,id,o.customerId,note,o.finalAmountFen,note]);
    await c.execute('INSERT INTO delivery_breaches(orderId,deadline,disputeId,createdAt) VALUES(?,?,?,UTC_TIMESTAMP(3))',[id,term.deadline,disputeId]);
    await c.execute("UPDATE orders SET status='CLOSED',updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND status='IN_PROGRESS'",[id]);
    await message('订单已触发逾期48小时违约判定，已关闭履约并登记全额待退款。请等待平台处理，当前并非已退款。');
    breach={disputeId,refundStatus:'PENDING'};
   }
  }
  const [records]=await c.execute('SELECT kind,createdAt FROM delivery_reminders WHERE orderId=? AND deadline=?',[id,term.deadline]);
  return {isOverdue,reminded:records.some(x=>x.kind==='OVERDUE'),nudged:records.some(x=>x.kind==='NUDGE'),breach};
 });
 const chat=pushes.length?require('./chat-svc'):null;
 for(const p of pushes){if(p.conv._isNew)chat.publishConversationDoc(p.conv);chat.publishSystemMessage(p.conv.id,p.content,p.msg.msgId,{actionOrderId:id});}
 return result;
}
let running=false,timer=null;
async function sweep(){if(running)return;running=true;try{
 const rows=await query("SELECT o.id FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId LEFT JOIN order_delivery_terms t ON t.orderId=o.id WHERE o.status='IN_PROGRESS' AND o.deletedAt IS NULL AND o.paidAt IS NOT NULL AND COALESCE(t.deadline,DATE_ADD(o.paidAt,INTERVAL q.days DAY))<UTC_TIMESTAMP(3)");
 for(const r of rows)try{await inspect(r.id);}catch(e){console.error('[overdue-order]',r.id,e.message);}
 }finally{running=false;}}
function start(){if(timer)return;const run=()=>sweep().catch(e=>console.error('[overdue-sweep]',e.message));run();timer=setInterval(run,60000);timer.unref?.();}
module.exports={inspect,eligible,sweep,start};
