'use strict';
const {query,queryOne,parseJson}=require('../db');
const {v}=require('../lib/util');
const {tags}=require('./hall-analytics');
const rate=(n,d)=>Number(d)?Math.round(Number(n||0)/Number(d)*1000)/10:null;
function windowFor(days,now=new Date()) {
 days=v.int(days,'统计天数',{min:1,max:90});
 const until=now.toISOString().slice(0,23).replace('T',' ');
 const from=new Date(now-days*86400000).toISOString().slice(0,23).replace('T',' ');
 const previous=new Date(now-days*2*86400000).toISOString().slice(0,23).replace('T',' ');
 return {days,from,until,previous};
}
const eq=(a,b)=>`${a} COLLATE utf8mb4_unicode_ci=${b} COLLATE utf8mb4_unicode_ci`;
const publicScope=`NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE ${eq('dd.orderId','o.id')})`;
const hasQuote=`EXISTS(SELECT 1 FROM quotes q WHERE ${eq('q.orderId','o.id')})`;
const refund=`EXISTS(SELECT 1 FROM refund_requests r WHERE ${eq('r.orderId','o.id')})`;
const dispute=`EXISTS(SELECT 1 FROM disputes d WHERE ${eq('d.orderId','o.id')} AND d.status<>'CANCELLED')`;
const cohortSql=`SELECT COUNT(*) total,SUM(${hasQuote}) quoted,SUM(o.selectedAt IS NOT NULL) selected,SUM(o.paidAt IS NOT NULL) paid,SUM(o.deliveredAt IS NOT NULL) delivered,SUM(o.completedAt IS NOT NULL) completed,SUM(${refund}) refunds,SUM(${dispute}) disputes,AVG(TIMESTAMPDIFF(MINUTE,o.createdAt,(SELECT MIN(q.createdAt) FROM quotes q WHERE ${eq('q.orderId','o.id')})))/60 firstQuoteHours FROM orders o WHERE ${publicScope} AND o.createdAt>=? AND o.createdAt<?`;
function funnel(row={}){let previous=Number(row.total||0);return [['total','发布需求'],['quoted','收到报价'],['selected','选定工程师'],['paid','支付'],['delivered','交付'],['completed','完成']].map(([key,label],i)=>{const count=Number(row[key]||0),conversion=i?rate(count,previous):null;previous=count;return {key,label,count,conversion,share:rate(count,row.total)};});}
function supply(rows,engineers){const map=new Map();const get=name=>{if(!map.has(name))map.set(name,{name,demand:0,quoted:0,completed:0,engineers:0,refunds:0,disputes:0});return map.get(name);};for(const r of rows){const names=tags(r.directionTags);for(const name of names.length?names:['未填写方向'])for(const key of ['demand','quoted','completed','refunds','disputes'])get(name)[key]+=Number(r[key]||0);}for(const e of engineers)for(const name of tags(e.specialties))get(name).engineers+=Number(e.count||0);return [...map.values()].map(x=>({...x,noQuoteRate:rate(x.demand-x.quoted,x.demand),completionRate:rate(x.completed,x.demand)})).sort((a,b)=>b.demand-a.demand);}
async function overview(days,permissions){
 const dates=windowFor(days),args=[dates.from,dates.until];
 const [current,previous,daily,directionRows,engineers,promotions,retention,activity,quality,service,issues,exceptions,overdue,newCustomers,backlog,plansRow,engineerQuality]=await Promise.all([
  queryOne(cohortSql,args),queryOne(cohortSql,[dates.previous,dates.from]),
  query(`SELECT DATE_FORMAT(DATE_ADD(o.createdAt,INTERVAL 8 HOUR),'%Y-%m-%d') day,COUNT(*) total,SUM(o.paidAt IS NOT NULL) paid,SUM(o.completedAt IS NOT NULL) completed FROM orders o WHERE ${publicScope} AND o.createdAt>=? AND o.createdAt<? GROUP BY day ORDER BY day`,args),
  query(`SELECT o.directionTags,COUNT(*) demand,SUM(${hasQuote}) quoted,SUM(o.completedAt IS NOT NULL) completed,SUM(${refund}) refunds,SUM(${dispute}) disputes FROM orders o WHERE ${publicScope} AND o.createdAt>=? AND o.createdAt<? GROUP BY o.directionTags`,args),
  query("SELECT ep.specialties,COUNT(*) count FROM engineer_profiles ep JOIN users u ON u.id=ep.userId WHERE u.status='ACTIVE' AND u.role='ENGINEER' AND u.deletedAt IS NULL AND EXISTS(SELECT 1 FROM identity_verifications iv WHERE iv.userId=u.id AND iv.verifyStatus='APPROVED') GROUP BY ep.specialties"),
  query(`SELECT o.promotion,COUNT(*) count,COALESCE(SUM(o.viewCount),0) views,SUM(${hasQuote}) quoted,SUM(o.paidAt IS NOT NULL) paid FROM orders o WHERE ${publicScope} AND o.createdAt>=? AND o.createdAt<? GROUP BY o.promotion`,args),
  query(`SELECT horizons.days,COUNT(*) eligible,SUM((SELECT COUNT(*) FROM orders secondOrder WHERE secondOrder.customerId=firsts.customerId AND secondOrder.paidAt>=firsts.firstPaid AND secondOrder.paidAt<=DATE_ADD(firsts.firstPaid,INTERVAL horizons.days DAY))>1) repeated FROM (SELECT customerId,MIN(paidAt) firstPaid FROM orders WHERE paidAt IS NOT NULL GROUP BY customerId) firsts CROSS JOIN (SELECT 30 days UNION ALL SELECT 60 UNION ALL SELECT 90) horizons WHERE firsts.firstPaid<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL horizons.days DAY) GROUP BY horizons.days`),
  queryOne(`SELECT COUNT(DISTINCT engineerId) active,COUNT(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM quotes old WHERE old.engineerId=q.engineerId AND old.createdAt>=? AND old.createdAt<?) THEN engineerId END) returningEngineers FROM quotes q WHERE q.createdAt>=? AND q.createdAt<?`,[dates.previous,dates.from,...args]),
  queryOne('SELECT COUNT(*) count,SUM((qualityScore+attitudeScore+speedScore)/3<3) lowCount,AVG((qualityScore+attitudeScore+speedScore)/3) average FROM engineer_reviews WHERE createdAt>=? AND createdAt<?',args),
  query(`SELECT t.channel,COUNT(*) count,SUM(t.status IN ('OPEN','PROCESSING')) unresolved,SUM(firstReply.repliedAt IS NOT NULL) replied,AVG(TIMESTAMPDIFF(MINUTE,t.createdAt,firstReply.repliedAt)) firstReplyMinutes FROM service_tickets t LEFT JOIN (SELECT ticketId,MIN(createdAt) repliedAt FROM service_ticket_messages WHERE senderKind='STAFF' GROUP BY ticketId) firstReply ON ${eq('firstReply.ticketId','t.id')} WHERE t.createdAt>=? AND t.createdAt<? GROUP BY t.channel`,args),
  query('SELECT category,COUNT(*) count FROM service_tickets WHERE createdAt>=? AND createdAt<? GROUP BY category ORDER BY count DESC',args),
  permissions.orders?query(`SELECT o.id,o.orderNo,o.projectName,o.status,TIMESTAMPDIFF(HOUR,o.createdAt,UTC_TIMESTAMP(3)) ageHours,CASE WHEN o.status='QUOTING' AND NOT ${hasQuote} THEN 'NO_QUOTE' WHEN o.status='QUOTING' THEN 'NOT_SELECTED' WHEN o.status='DISPUTING' THEN 'DISPUTE' ELSE 'UNPAID' END category FROM orders o WHERE o.deletedAt IS NULL AND ((o.status='QUOTING' AND ${publicScope} AND o.createdAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 48 HOUR)) OR (o.status='DISPUTING' AND EXISTS(SELECT 1 FROM disputes d WHERE ${eq('d.orderId','o.id')} AND d.status='OPEN' AND d.createdAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 7 DAY))) OR (o.status='AWAITING_PAYMENT' AND o.selectedAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR))) ORDER BY o.createdAt,o.id LIMIT 51`):Promise.resolve([]),
  permissions.orders?query(`SELECT o.id,o.orderNo,o.projectName,COALESCE(t.deadline,DATE_ADD(o.paidAt,INTERVAL q.days DAY)) deadline FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId LEFT JOIN order_delivery_terms t ON ${eq('t.orderId','o.id')} WHERE o.status='IN_PROGRESS' AND o.deletedAt IS NULL AND o.paidAt IS NOT NULL AND COALESCE(t.deadline,DATE_ADD(o.paidAt,INTERVAL q.days DAY))<UTC_TIMESTAMP(3) ORDER BY deadline,o.id LIMIT 51`):Promise.resolve([]),
  queryOne(`SELECT COUNT(*) registered,SUM(EXISTS(SELECT 1 FROM orders o WHERE o.customerId=u.id)) published,SUM(EXISTS(SELECT 1 FROM orders o WHERE o.customerId=u.id AND o.paidAt IS NOT NULL)) paid FROM users u WHERE u.role='CUSTOMER' AND u.createdAt>=? AND u.createdAt<?`,args),
  query("SELECT channel,COUNT(*) count,SUM(createdAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 24 HOUR)) olderDay FROM service_tickets WHERE status IN ('OPEN','PROCESSING') GROUP BY channel"),
  queryOne("SELECT valueJson FROM admin_console_settings WHERE settingKey='operationsPlans'"),
  permissions.orders?query(`SELECT q.engineerId,u.nickname,COUNT(*) orders,SUM(o.completedAt IS NOT NULL) completed,SUM(${refund}) refunds,SUM(${dispute}) disputes FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId JOIN users u ON u.id=q.engineerId WHERE o.selectedAt>=? AND o.selectedAt<? GROUP BY q.engineerId,u.nickname ORDER BY orders DESC,q.engineerId LIMIT 20`,args):Promise.resolve([])
 ]);
 return {engineerQuality,plans:parseJson(plansRow?.valueJson,[])||[],newCustomers,backlog,overdue:overdue.slice(0,50),overdueMore:overdue.length>50,dates,current,previous,funnel:funnel(current),daily,directions:supply(directionRows,engineers),promotions,retention:retention.map(x=>({...x,rate:rate(x.repeated,x.eligible)})),activity,quality,service,issues,exceptions:exceptions.slice(0,50),exceptionsMore:exceptions.length>50,permissions};
}
module.exports={overview,windowFor,funnel,supply,rate};
