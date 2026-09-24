'use strict';
const {query,queryOne,parseJson}=require('../db');
const {DICTS}=require('../routes/dicts');
const REFUND_TYPES=['未按约定交付','交付成果不符合需求','工程师无法继续服务','双方协商退款','其他'];
const DISPUTE_TYPES={QUALITY:'成果质量不符',DELAY:'交付延迟',MISSING:'成果缺失',PAYMENT:'费用争议',COMMUNICATION:'沟通不畅',OTHER:'其他'};
const publicScope="NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE dd.orderId COLLATE utf8mb4_unicode_ci=o.id COLLATE utf8mb4_unicode_ci)";
function tags(value){const parsed=parseJson(value,[]);return [...new Set((Array.isArray(parsed)?parsed:[]).filter(x=>typeof x==='string'&&x.trim()).map(x=>x.trim()))];}
function directions(orderGroups,engineerGroups){
 const map=new Map();const get=key=>{if(!map.has(key))map.set(key,{name:key,demand:0,completed:0,open:0,terminated:0,engineers:0});return map.get(key);};
 for(const name of DICTS.directions)get(name);
 for(const row of orderGroups){const names=tags(row.directionTags);for(const name of names.length?names:['未填写方向']){const item=get(name),n=Number(row.count);item.demand+=n;if(row.status==='COMPLETED')item.completed+=n;if(row.status==='QUOTING'&&!Number(row.deleted))item.open+=n;if(['CLOSED','CANCELLED'].includes(row.status))item.terminated+=n;}}
 for(const row of engineerGroups)for(const name of tags(row.specialties))get(name).engineers+=Number(row.count);
 const max=Math.max(1,...[...map.values()].map(x=>x.demand));
 return [...map.values()].map(x=>({...x,completionRate:x.demand?Math.round(x.completed/x.demand*100):null,heat:Math.round(x.demand/max*100),completedHeat:Math.round(x.completed/max*100)})).sort((a,b)=>b.demand-a.demand||b.completed-a.completed||a.name.localeCompare(b.name,'zh-CN'));
}
async function analytics(){
 const legacyCase=REFUND_TYPES.map(t=>`WHEN r.reason=? OR r.reason LIKE ? THEN ?`).join(' ');
 const category=`COALESCE(NULLIF(r.reasonType,''),CASE ${legacyCase} ELSE '历史未分类' END)`;
 const categoryArgs=REFUND_TYPES.flatMap(t=>[t,t+'：%',t]);
 const [orders,supply,failures,disputes,refunds,incidentTotals]=await Promise.all([
  query(`SELECT o.directionTags,o.status,(o.deletedAt IS NOT NULL) deleted,COUNT(*) count FROM orders o WHERE ${publicScope} GROUP BY o.directionTags,o.status,(o.deletedAt IS NOT NULL)`),
  query("SELECT ep.specialties,COUNT(*) count FROM engineer_profiles ep JOIN users u ON u.id=ep.userId WHERE u.status='ACTIVE' AND u.deletedAt IS NULL AND u.role='ENGINEER' AND EXISTS(SELECT 1 FROM identity_verifications iv WHERE iv.userId=u.id AND iv.verifyStatus='APPROVED') GROUP BY ep.specialties"),
  query(`SELECT CASE WHEN EXISTS(SELECT 1 FROM disputes d WHERE d.orderId=o.id AND d.status='RESOLVED' AND d.orderAction='CLOSE') THEN 'DISPUTE_CLOSE' WHEN EXISTS(SELECT 1 FROM refund_requests r WHERE r.orderId=o.id AND r.status='AGREED') THEN 'REFUND_CANCEL' WHEN o.closedByAdminId IS NOT NULL THEN 'ADMIN_CLOSE' WHEN o.status='CANCELLED' THEN 'CANCEL_OTHER' WHEN o.paidAt IS NULL THEN 'UNPAID_CLOSE' ELSE 'CLOSE_OTHER' END category,COUNT(*) count FROM orders o WHERE ${publicScope} AND o.status IN ('CLOSED','CANCELLED') GROUP BY category`),
  query(`SELECT d.reasonType,d.status,COUNT(*) count,COUNT(DISTINCT d.orderId) orders FROM disputes d JOIN orders o ON o.id=d.orderId WHERE ${publicScope} GROUP BY d.reasonType,d.status`),
  query(`SELECT ${category} category,r.status,COUNT(*) count,COUNT(DISTINCT r.orderId) orders FROM refund_requests r JOIN orders o ON o.id=r.orderId WHERE ${publicScope} GROUP BY category,r.status`,categoryArgs),
  queryOne(`SELECT COUNT(*) total,SUM(o.status='COMPLETED') completed,SUM(o.status IN ('CANCELLED','CLOSED')) terminated,SUM(EXISTS(SELECT 1 FROM disputes d WHERE d.orderId=o.id AND d.status<>'CANCELLED')) disputeOrders,SUM(EXISTS(SELECT 1 FROM refund_requests r WHERE r.orderId=o.id)) refundOrders FROM orders o WHERE ${publicScope}`)
 ]);
 const failureLabels={DISPUTE_CLOSE:'仲裁关闭',REFUND_CANCEL:'同意退款后取消',ADMIN_CLOSE:'管理员关闭',CANCEL_OTHER:'其他取消',UNPAID_CLOSE:'未支付即关闭（含主动撤回）',CLOSE_OTHER:'其他关闭'};
 const statusLabels={OPEN:'进行中',RESOLVED:'已结案',CANCELLED:'已撤销',PENDING:'待处理',AGREED:'已同意',REJECTED:'已拒绝',ESCALATED:'已升级纠纷'};
 return {directions:directions(orders,supply),totals:Object.fromEntries(Object.entries(incidentTotals||{}).map(([k,v])=>[k,Number(v||0)])),failures:failures.map(x=>({...x,label:failureLabels[x.category]||x.category,count:Number(x.count)})),disputes:disputes.map(x=>({...x,label:DISPUTE_TYPES[x.reasonType]||'未分类纠纷',statusText:statusLabels[x.status]||x.status,count:Number(x.count),orders:Number(x.orders)})),refunds:refunds.map(x=>({...x,statusText:statusLabels[x.status]||x.status,count:Number(x.count),orders:Number(x.orders)}))};
}
module.exports={analytics,directions,tags};
