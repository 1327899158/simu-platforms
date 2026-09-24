'use strict';
const {query,queryOne}=require('../db');
const {ok,err,readJson}=require('../lib/http');
const {requireAdmin}=require('../lib/admin-mw');
const {v}=require('../lib/util');
function period(q,now=new Date()) {
  const local=new Date(now.getTime()+8*3600000),endDay=local.toISOString().slice(0,10);
  let start=new Date(endDay+'T00:00:00Z'),end=new Date(start.getTime()+86400000);
  const range=q.get('range')||'month';
  if(range==='week')start.setUTCDate(start.getUTCDate()-((start.getUTCDay()+6)%7));
  else if(range==='month')start.setUTCDate(1);
  else if(range==='custom') {
    const parse=x=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(x||''))throw err.bad('请选择有效日期');const d=new Date(x+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==x)throw err.bad('日期无效');return d;};
    start=parse(q.get('start'));end=new Date(parse(q.get('end')).getTime()+86400000);
    if(end<=start||end-start>366*86400000)throw err.bad('时间范围须按先后顺序且不超过366天');
  } else if(range!=='today')throw err.bad('不支持的时间范围');
  const sqlDate=d=>new Date(d.getTime()-8*3600000).toISOString().slice(0,19).replace('T',' ');
  return {range,start:start.toISOString().slice(0,10),end:new Date(end.getTime()-86400000).toISOString().slice(0,10),from:sqlDate(start),until:sqlDate(end)};
}
function promotionSummary(rows){
  return [['EXPOSURE','增加曝光',1900],['URGENT','置顶加急',2900]].map(([key,label,unitFen])=>{
    const count=Number(rows.find(r=>r.promotion===key)?.count || 0);
    return {key,label,unitFen,count,estimatedFen:count*unitFen,receivedFen:null,paymentStatus:'NOT_INTEGRATED'};
  });
}
function register(router){
  router.get('/api/admin/finance/overview',async(req,res,_p,q)=>{
    await requireAdmin(req,'FINANCE_READ');const dates=period(q),args=[dates.from,dates.until];
    const [paid,pending,issued,withdrawals,queue,invoices,daily,promotionRows]=await Promise.all([
      queryOne("SELECT COALESCE(SUM(amountFen),0) amountFen,COUNT(*) count FROM payments WHERE status='SUCCESS' AND paidAt>=? AND paidAt<?",args),
      queryOne("SELECT COALESCE(SUM(o.finalAmountFen),0) amountFen FROM orders o WHERE o.deletedAt IS NULL AND o.status IN ('IN_PROGRESS','DELIVERED') AND EXISTS(SELECT 1 FROM payments p WHERE p.orderId=o.id AND p.status='SUCCESS' AND p.amountFen=o.finalAmountFen)"),
      queryOne("SELECT COALESCE(SUM(o.finalAmountFen),0) amountFen,COUNT(*) count FROM invoice_requests i JOIN orders o ON o.id=i.orderId WHERE i.status='ISSUED' AND i.updatedAt>=? AND i.updatedAt<?",args),
      queryOne("SELECT COALESCE(SUM(amountFen),0) amountFen,SUM(amountFen>500000) largeCount,SUM(amountFen<=500000) smallCount FROM demo_withdrawals WHERE status IN ('SUBMITTED','APPROVED','PAYING')"),
      query("SELECT w.id,w.amountFen,w.bankLabel,w.status,w.createdAt,u.nickname FROM demo_withdrawals w JOIN users u ON u.id COLLATE utf8mb4_unicode_ci=w.userId COLLATE utf8mb4_unicode_ci WHERE w.amountFen>500000 AND w.status IN ('SUBMITTED','APPROVED','PAYING') ORDER BY w.createdAt,w.id LIMIT 50"),
      query("SELECT i.id,i.orderId,i.invoiceTitle,o.orderNo,o.projectName,o.finalAmountFen FROM invoice_requests i JOIN orders o ON o.id=i.orderId WHERE i.status='PLATFORM_REQUESTED' ORDER BY i.requestedAt,i.id LIMIT 50"),
      query("SELECT DATE_FORMAT(DATE_ADD(paidAt,INTERVAL 8 HOUR),'%Y-%m-%d') day,COUNT(*) count,SUM(amountFen) amountFen FROM payments WHERE status='SUCCESS' AND paidAt>=? AND paidAt<? GROUP BY day ORDER BY day",args),
      query("SELECT o.promotion,COUNT(*) count FROM orders o WHERE o.promotion IN ('EXPOSURE','URGENT') AND o.createdAt>=? AND o.createdAt<? AND NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE dd.orderId COLLATE utf8mb4_unicode_ci=o.id COLLATE utf8mb4_unicode_ci) GROUP BY o.promotion",args)
    ]);
    const promotions=promotionSummary(promotionRows);
    return ok(res,{dates,paid,pending,issued,withdrawals,queue,invoices,daily,incomeFen:null,promotions,
      promotionBasis:'按所选期间发布且选择该方式的公开需求计次，含后续关闭的历史记录；以当前标价测算，未实际收款、不构成应收欠款，不计入平台实际收入。', 
      notice:'平台抽佣、服务费和真实结算账本未接入；待履约金额是订单总额，不是可结算余额。提现为模拟资金。统计含历史模拟支付。待办队列不受日期筛选影响，每类最多显示最早50笔。'});
  });
  router.get('/api/admin/finance/withdrawals/:id',async(req,res,p)=>{
    await requireAdmin(req,'WALLET_MANAGE');
    const item=await queryOne('SELECT w.*,u.nickname FROM demo_withdrawals w JOIN users u ON u.id COLLATE utf8mb4_unicode_ci=w.userId COLLATE utf8mb4_unicode_ci WHERE w.id=?',[p.id]);
    if(!item)throw err.notFound('提现记录不存在');
    const events=await query('SELECT status,note,createdAt FROM demo_withdrawal_events WHERE withdrawalId=? ORDER BY createdAt,id',[p.id]);
    const feeFen=Math.round(Number(item.amountFen)*6/1000);
    return ok(res,{item,events,feeFen,netFen:Number(item.amountFen)-feeFen,mode:'SIMULATED'});
  });
  router.post('/api/admin/finance/withdrawals/:id',async(req,res,p)=>{
    const {admin}=await requireAdmin(req,'WALLET_MANAGE'),b=await readJson(req);
    v.oneOf(b.status,'处理状态',['APPROVED','REJECTED','PAYING','PAID_SIMULATED','FAILED']);
    const note=v.str(b.note,'处理原因',{min:2,max:300});
    return ok(res,await require('../services/demo-wallet-svc').transition(p.id,b.status,note,null,req,admin));
  });
}
module.exports={register,period,promotionSummary};
