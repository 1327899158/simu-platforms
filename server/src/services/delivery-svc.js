'use strict';
const {tx}=require('../db');
const {err}=require('../lib/http');
const {v,newId}=require('../lib/util');
function initialDeadline(o) {
  const paid=new Date(o.paidAt).getTime(), days=Number(o.days);
  if(!o.paidAt||!Number.isFinite(paid)||!Number.isInteger(days)||days<1)throw err.conflict('订单缺少付款时间或承诺工期，请联系管理员核查');
  return new Date(paid+days*86400000);
}
function authorize(o,user,action){
  if(!o||o.deletedAt)throw err.notFound('订单不存在');
  if(user.id!==o.customerId&&user.id!==o.engineerId)throw err.forbidden('仅订单双方可操作');
  if(action&&o.status!=='IN_PROGRESS')throw err.conflict('仅进行中的订单可申请或处理延期');
  if(action==='apply'&&(user.role!=='ENGINEER'||user.id!==o.engineerId))throw err.forbidden('仅已接单工程师可申请');
  if(action==='respond'&&(user.role!=='CUSTOMER'||user.id!==o.customerId))throw err.forbidden('仅订单客户可审批');
}
async function run(user,id,action,b={}) {return tx(async c=>{
  const [[o]]=await c.execute('SELECT o.*,q.engineerId,q.days FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=? FOR UPDATE',[id]);
  authorize(o,user,action);
  if(!o.paidAt){if(action)throw err.conflict('订单缺少付款时间，暂不能申请或审批延期');return {deadline:null,items:[],serverNow:new Date().toISOString()};}
  await c.execute('INSERT IGNORE INTO order_delivery_terms(orderId,deadline,updatedAt) VALUES(?,?,UTC_TIMESTAMP(3))',[id,initialDeadline(o)]);
  const [[term]]=await c.execute('SELECT * FROM order_delivery_terms WHERE orderId=? FOR UPDATE',[id]);
  if(action==='apply'){
    const days=v.int(b.days,'延期天数',{min:1,max:90}),reason=v.str(b.reason,'延期原因',{min:2,max:1000});
    const [[pending]]=await c.execute("SELECT id FROM delivery_extensions WHERE orderId=? AND status='PENDING' LIMIT 1",[id]);
    if(pending)throw err.conflict('已有待处理延期申请');
    await c.execute("INSERT INTO delivery_extensions(id,orderId,engineerId,days,reason,status,oldDeadline,proposedDeadline,createdAt) VALUES(?,?,?,?,?,'PENDING',?,?,UTC_TIMESTAMP(3))",[newId(),id,user.id,days,reason,term.deadline,new Date(new Date(term.deadline).getTime()+days*86400000)]);
  }
  if(action==='respond'){
    const decision=v.oneOf(b.decision,'决定',['APPROVED','REJECTED']);
    const [[r]]=await c.execute('SELECT * FROM delivery_extensions WHERE id=? AND orderId=? FOR UPDATE',[b.id||'',id]);
    if(!r||r.status!=='PENDING')throw err.conflict('该申请已处理或不存在');
    if(new Date(r.oldDeadline).getTime()!==new Date(term.deadline).getTime())throw err.conflict('截止时间已变化，请刷新');
    if(decision==='APPROVED')await c.execute('UPDATE order_delivery_terms SET deadline=?,updatedAt=UTC_TIMESTAMP(3) WHERE orderId=?',[r.proposedDeadline,id]);
    await c.execute('UPDATE delivery_extensions SET status=?,respondedAt=UTC_TIMESTAMP(3) WHERE id=?',[decision,r.id]);
  }
  const [[current]]=await c.execute('SELECT deadline FROM order_delivery_terms WHERE orderId=?',[id]);
  const [items]=await c.execute('SELECT * FROM delivery_extensions WHERE orderId=? ORDER BY createdAt DESC,id DESC LIMIT 50',[id]);
  return {deadline:current.deadline,serverNow:new Date().toISOString(),canApply:o.status==='IN_PROGRESS'&&user.id===o.engineerId,canRespond:o.status==='IN_PROGRESS'&&user.id===o.customerId,items};
});}
module.exports={run,authorize,initialDeadline};
