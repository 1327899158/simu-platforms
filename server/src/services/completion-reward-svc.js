'use strict';
const {query,tx}=require('../db');const {newId}=require('../lib/util');
async function grant(orderId){return tx(async c=>{
 const [[o]]=await c.execute("SELECT o.*,q.engineerId FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=? FOR UPDATE",[orderId]);
 if(!o||o.status!=='COMPLETED'||o.deletedAt||!o.completedAt||new Date(o.completedAt).getTime()>Date.now())return;
 const [[activation]]=await c.execute("SELECT activatedAt FROM feature_activation WHERE feature='ORDER_COMPLETE_500'");
 if(!activation||new Date(o.completedAt)<new Date(activation.activatedAt))return;
 const [[payment]]=await c.execute("SELECT id FROM payments WHERE orderId=? AND status='SUCCESS' AND amountFen=? LIMIT 1",[orderId,o.finalAmountFen]);if(!payment)return;
 for(const id of new Set([o.customerId,o.engineerId])){
  const [[u]]=await c.execute("SELECT id FROM users WHERE id=? AND status='ACTIVE' AND deletedAt IS NULL",[id]);if(!u)continue;
  await c.execute("INSERT IGNORE INTO incentive_rewards(id,userId,taskKey,periodKey,amount,status,createdAt) VALUES(?,?,'ORDER_COMPLETE',?,500,'RESERVED',UTC_TIMESTAMP(3))",[newId(),id,orderId]);
 }
});}
let busy=false,timer;
async function sweep(){if(busy)return;busy=true;try{const rows=await query("SELECT o.id FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId JOIN feature_activation a ON a.feature='ORDER_COMPLETE_500' WHERE o.status='COMPLETED' AND o.deletedAt IS NULL AND o.completedAt>=a.activatedAt AND o.completedAt<=UTC_TIMESTAMP(3) AND (NOT EXISTS(SELECT 1 FROM incentive_rewards r WHERE r.userId=o.customerId AND r.taskKey='ORDER_COMPLETE' AND r.periodKey=o.id) OR NOT EXISTS(SELECT 1 FROM incentive_rewards r WHERE r.userId=q.engineerId AND r.taskKey='ORDER_COMPLETE' AND r.periodKey=o.id))");for(const o of rows)try{await grant(o.id);}catch(e){console.error('[completion-reward]',o.id,e.message);}}finally{busy=false;}}
function start(){if(timer)return;const run=()=>sweep().catch(e=>console.error('[completion-reward-sweep]',e.message));run();timer=setInterval(run,60000);timer.unref?.();}
module.exports={grant,sweep,start};
