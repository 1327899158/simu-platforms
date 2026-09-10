'use strict';
const {query,queryOne}=require('../db');
const {requireUser}=require('../lib/auth-mw');
const {ok,err}=require('../lib/http');
const {v}=require('../lib/util');
const {config}=require('../config');
function months(now=new Date()){
 const local=new Date(now.getTime()+8*3600000);
 return Array.from({length:6},(_,i)=>{const d=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-5+i,1));return d.toISOString().slice(0,7);});
}
const FROM = `FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId
 WHERE q.engineerId=? AND o.deletedAt IS NULL
 AND o.status IN ('COMPLETED','IN_PROGRESS','DELIVERED','REFUND_PENDING','DISPUTING')
 AND EXISTS (SELECT 1 FROM payments p WHERE p.orderId=o.id AND p.status='SUCCESS' AND p.amountFen=o.finalAmountFen)`;
function register(router){
 router.get('/api/engineers/earnings',async(req,res,_p,search)=>{
  const user=await requireUser(req);
  if(user.role!=='ENGINEER')throw err.forbidden('仅工程师可查看本人收益数据');
  const offset=v.int(search.get('offset')||0,'offset',{min:0,max:1000000});
  const keys=months(),month=keys[5];
  const summary=await queryOne(`SELECT
   COALESCE(SUM(CASE WHEN o.status='COMPLETED' THEN o.finalAmountFen ELSE 0 END),0) AS completedFen,
   COALESCE(SUM(CASE WHEN o.status='COMPLETED' THEN 1 ELSE 0 END),0) AS completedCount,
   COALESCE(SUM(CASE WHEN o.status='COMPLETED' AND DATE_FORMAT(DATE_ADD(o.completedAt,INTERVAL 8 HOUR),'%Y-%m')=? THEN o.finalAmountFen ELSE 0 END),0) AS monthFen,
   COALESCE(SUM(CASE WHEN o.status IN ('IN_PROGRESS','DELIVERED') THEN o.finalAmountFen ELSE 0 END),0) AS activeFen,
   COALESCE(SUM(CASE WHEN o.status IN ('REFUND_PENDING','DISPUTING') THEN o.finalAmountFen ELSE 0 END),0) AS heldFen
   ${FROM}`,[month,user.id]);
  const trend=await query(`SELECT DATE_FORMAT(DATE_ADD(o.completedAt,INTERVAL 8 HOUR),'%Y-%m') AS month,SUM(o.finalAmountFen) AS amountFen
   ${FROM} AND o.status='COMPLETED'
   AND DATE_FORMAT(DATE_ADD(o.completedAt,INTERVAL 8 HOUR),'%Y-%m')>=?
   GROUP BY month ORDER BY month`,[user.id,keys[0]]);
  const rows=await query(`SELECT o.id,o.projectName,o.status,o.finalAmountFen,o.completedAt,o.paidAt
   ${FROM} ORDER BY COALESCE(o.completedAt,o.paidAt) DESC,o.id DESC LIMIT 21 OFFSET ${offset}`,[user.id]);
  ok(res,{summary:Object.fromEntries(Object.entries(summary||{}).map(([k,value])=>[k,Number(value||0)])),
   trend:keys.map(month=>({month,amountFen:Number(trend.find(x=>x.month===month)?.amountFen||0)})),
   items:rows.slice(0,20).map(r=>({...r,finalAmountFen:Number(r.finalAmountFen||0)})),
   nextOffset:rows.length>20?offset+20:null,paymentMode:config.paymentMode,
   basis:'按有成功支付记录的本人承接订单统计。金额为订单含费总额，未扣平台费用，不代表到账或可提现余额；退款中、纠纷中单列，取消订单不计入。'});
 });
}
module.exports={register,months};

