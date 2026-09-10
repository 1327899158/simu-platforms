'use strict';
const { query,queryOne } = require('../db');
const { v } = require('../lib/util');
const { err } = require('../lib/http');
const types=['ENGINEER','CASE','DEMAND'];
// 同一可见性条件用于收藏、列表与分页；不把私有需求或失效案例返回客户端。
function source(kind) {
  if(kind==='ENGINEER') return {from:"users t JOIN identity_verifications iv ON iv.userId=t.id",title:'t.nickname',extra:'t.avatarUrl',where:"t.role='ENGINEER' AND t.status='ACTIVE' AND t.deletedAt IS NULL AND iv.verifyStatus='APPROVED'"};
  if(kind==='CASE') return {from:'engineer_cases t JOIN orders o ON o.id=t.orderId JOIN quotes q ON q.id=o.selectedQuoteId AND q.engineerId=t.engineerId JOIN users u ON u.id=t.engineerId JOIN identity_verifications iv ON iv.userId=u.id',title:'t.title',extra:'t.engineerId',where:"o.status='COMPLETED' AND o.deletedAt IS NULL AND u.status='ACTIVE' AND u.role='ENGINEER' AND u.deletedAt IS NULL AND iv.verifyStatus='APPROVED'"};
  return {from:'orders t JOIN users u ON u.id=t.customerId',title:'t.projectName',extra:'t.customerId',where:"t.status='QUOTING' AND t.deletedAt IS NULL AND u.status='ACTIVE' AND u.deletedAt IS NULL AND NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE dd.orderId=t.id)"};
}
async function add(userId,kind,id) {
  v.oneOf(kind,'收藏分类',types);id=v.str(id,'目标ID',{min:1,max:32});
  if(kind==='ENGINEER'&&id===userId)throw err.bad('不能收藏自己');
  const s=source(kind);
  if(!await queryOne(`SELECT t.id FROM ${s.from} WHERE t.id=? AND ${s.where}`,[id])) throw err.notFound('内容不存在或已停止公开');
  await query('INSERT IGNORE INTO user_favorites(userId,kind,targetId,createdAt) VALUES(?,?,?,UTC_TIMESTAMP(3))',[userId,kind,id]);
  return {saved:true};
}
async function list(userId,kind,offset=0) {
  v.oneOf(kind,'收藏分类',types);offset=v.int(offset,'offset',{min:0,max:1000000});const s=source(kind);
  const selfFilter=kind==='ENGINEER'?' AND t.id<>f.userId':'';
  const rows=await query(`SELECT f.targetId AS id,f.kind,${s.title} AS title,${s.extra},f.createdAt FROM ${s.from} JOIN user_favorites f ON f.targetId=t.id WHERE f.userId=? AND f.kind=? AND ${s.where}${selfFilter} ORDER BY f.createdAt DESC,f.targetId LIMIT 21 OFFSET ${offset}`,[userId,kind]);
  return {items:rows.slice(0,20),nextOffset:rows.length>20?offset+20:null};
}
async function remove(userId,kind,ids) {
  v.oneOf(kind,'收藏分类',types);ids=v.arr(ids,'收藏ID',{minLen:1,maxLen:50}).map(id=>v.str(id,'ID',{min:1,max:32}));
  await query(`DELETE FROM user_favorites WHERE userId=? AND kind=? AND targetId IN (${ids.map(()=>'?').join(',')})`,[userId,kind,...ids]);return {removed:true};
}
module.exports={add,list,remove,source};
