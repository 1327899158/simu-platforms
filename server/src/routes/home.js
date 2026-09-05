'use strict';
const { query, queryOne, parseJson } = require('../db');
const { ok, err, readJson } = require('../lib/http');
const { v, newId } = require('../lib/util');
const { requireUser } = require('../lib/auth-mw');
const { requireAdmin, writeAdminAudit } = require('../lib/admin-mw');
const { getLevel, LEVELS } = require('../services/engineer-level');
const { RULES } = require('../services/reward-policy');
const TYPES = ['结构强度','流体CFD','电磁兼容','热仿真','振动噪声','多物理场耦合','复合材料','其他'];
const DIRECTIONS = ['结构分析','流体分析','电磁场分析','热分析','声学分析','多物理场耦合','复合材料','其他'];
const BASE = [[2500,8000],[3000,10000],[3000,12000],[2000,7000],[3000,10000],[5000,18000],[3500,12000],[2000,10000]];
function register(router) {
  router.get('/api/home/reward-rules', async(req,res) => { await requireUser(req); ok(res, RULES); });
  router.get('/api/home/campaigns', async(req,res) => { await requireUser(req); ok(res,await query('SELECT * FROM home_campaigns WHERE enabled=1 ORDER BY sortOrder,id')); });
  router.get('/api/admin/campaigns', async(req,res) => { await requireAdmin(req,'CAMPAIGN_MANAGE'); ok(res,await query('SELECT * FROM home_campaigns ORDER BY sortOrder,id')); });
  router.post('/api/admin/campaigns', async(req,res) => {
    const {admin} = await requireAdmin(req,'CAMPAIGN_MANAGE'); const b=await readJson(req);
    const id=b.id?v.str(b.id,'活动ID',{min:1,max:32}):newId();
    const title=v.str(b.title,'标题',{min:1,max:120}), subtitle=v.str(b.subtitle,'摘要',{min:1,max:240}), content=v.str(b.content,'规则',{min:1,max:5000});
    const action=v.oneOf(b.action,'跳转方式',['PUBLISH','SHARE','ORDERS']);
    const sort=v.int(b.sortOrder??0,'排序',{min:0,max:1000});
    await query(`INSERT INTO home_campaigns(id,title,subtitle,content,action,enabled,sortOrder,updatedAt) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE title=VALUES(title),subtitle=VALUES(subtitle),content=VALUES(content),action=VALUES(action),enabled=VALUES(enabled),sortOrder=VALUES(sortOrder),updatedAt=VALUES(updatedAt)`,[id,title,subtitle,content,action,b.enabled===false?0:1,sort]);
    await writeAdminAudit(req,admin,'CAMPAIGN_UPDATE','CAMPAIGN',id,{title}); ok(res,{id});
  });
  router.get('/api/home/notices', async(req,res) => {
    const user=await requireUser(req);
    const rows=await query(`SELECT o.id,o.projectName,o.status,o.updatedAt,
      EXISTS(SELECT 1 FROM conversations c JOIN messages m ON m.convId=c.id WHERE c.orderId=o.id AND m.senderId=c.engineerId) AS contacted
      FROM orders o WHERE o.customerId=? AND o.deletedAt IS NULL AND o.status IN ('QUOTING','AWAITING_PAYMENT','IN_PROGRESS','DELIVERED','REFUND_PENDING','DISPUTING') ORDER BY o.updatedAt DESC`,[user.id]);
    const labels={DELIVERED:'工程师已提交成果，点击查看',AWAITING_PAYMENT:'需求已确认，点击完成支付',IN_PROGRESS:'工程师正在执行需求，点击查看进度',REFUND_PENDING:'退款申请处理中，点击查看',DISPUTING:'需求正在处理纠纷，点击查看'};
    ok(res,rows.filter(o=>labels[o.status]||o.contacted).map(o=>({id:o.id,text:labels[o.status]||'您的需求正在被工程师联系，点击查看进度',projectName:o.projectName})));
  });
  router.get('/api/engineers/level',async(req,res)=>{const u=await requireUser(req); if(u.role!=='ENGINEER') throw err.forbidden(); ok(res,{current:await getLevel(u.id),levels:LEVELS});});
  router.get('/api/home/engineers',async(req,res,_p,q)=>{
    await requireUser(req);
    const direction=String(q.get('direction')||'');
    const rows=await query(`SELECT u.id,u.nickname,u.avatarUrl,ep.specialties FROM users u JOIN engineer_profiles ep ON ep.userId=u.id JOIN identity_verifications iv ON iv.userId=u.id WHERE u.role='ENGINEER' AND u.status='ACTIVE' AND u.deletedAt IS NULL AND iv.verifyStatus='APPROVED'`);
    const all=rows.map(r=>({...r,specialties:parseJson(r.specialties)}));
    const categories=[...new Set(all.flatMap(r=>r.specialties))].sort();
    const filtered=all.filter(r=>!direction||r.specialties.includes(direction));
    // 等级在展示时从订单、评价、纠纷事实重新计算并持久化，退款或评价修改后不会沿用旧等级。
    const items=[]; for(const r of filtered) items.push({...r,level:await getLevel(r.id)});
    items.sort((a,b)=>b.level.weight-a.level.weight||b.level.completed-a.level.completed||a.id.localeCompare(b.id));
    const offset=v.int(q.get('offset')||0,'offset',{min:0,max:1000000});
    ok(res,{categories,total:items.length,items:items.slice(offset,offset+20),nextOffset:offset+20<items.length?offset+20:null});
  });
  router.post('/api/home/estimate',async(req,res)=>{
    await requireUser(req); const b=await readJson(req);
    const type=v.oneOf(b.type,'仿真类型',TYPES), complexity=v.oneOf(b.complexity,'需求规模',['简单','标准','复杂']);
    const i=TYPES.indexOf(type); const rows=await query(`SELECT finalAmountFen FROM orders WHERE status='COMPLETED' AND completedAt>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 90 DAY) AND finalAmountFen>0 AND JSON_CONTAINS(directionTags,?)`,[JSON.stringify(DIRECTIONS[i])]);
    let bounds=BASE[i],source='平台参考价（暂无足够成交样本）';
    if(rows.length>=5){const prices=rows.map(r=>Number(r.finalAmountFen)/100).sort((a,b)=>a-b); const mid=Math.floor(prices.length/2); const median=prices.length%2?prices[mid]:(prices[mid-1]+prices[mid])/2; const avg=prices.reduce((a,b)=>a+b,0)/prices.length; bounds=[Math.min(avg,median),Math.max(avg,median)]; source=`近90天同方向${rows.length}笔成交均值与中位数；规模系数调整`;}
    const factor=({'简单':0.55,'标准':1,'复杂':1.8}[complexity])*(b.urgent===true?1.15:1);
    ok(res,{low:Math.round(bounds[0]*factor),high:Math.round(bounds[1]*factor),source,direction:DIRECTIONS[i],type,complexity});
  });
}
module.exports={register};
