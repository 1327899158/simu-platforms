'use strict';
const { err } = require('../lib/http');
const { v, nowIso, newId } = require('../lib/util');
const { tx, parseJson } = require('../db');
const TAGS = ['需求描述清晰', '回复及时', '配合验收', '沟通友善', '按时付款', '需求反复修改'];

function reviewView(row) {
  if (!row) return null;
  return { id: row.id, score: Number(row.score), tags: parseJson(row.tags), content: row.content || '',
    revisionCount: Number(row.revisionCount || 0), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

async function saveReview(orderId, engineerId, body, editing) {
  const score = v.int(body.score, '客户评分', { min: 1, max: 5 });
  const tags = v.arr(body.tags || [], '评价标签', { maxLen: TAGS.length });
  if (tags.some(tag => !TAGS.includes(tag)) || new Set(tags).size !== tags.length) throw err.bad('评价标签不合法或重复');
  const content = v.str(body.content, '详细评价', { max: 500, optional: true }) || null;
  return tx(async conn => {
    // 首评和修改统一按订单、评价的顺序加锁，重新检查归属和状态。
    const [[order]] = await conn.execute(`SELECT o.id,o.status,o.customerId,q.engineerId
      FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId
      WHERE o.id=? AND o.deletedAt IS NULL FOR UPDATE`, [orderId]);
    if (!order || order.engineerId !== engineerId || order.customerId === engineerId) throw err.forbidden('仅订单工程师可评价该客户');
    if (order.status !== 'COMPLETED') throw err.conflict('仅已完成订单可评价客户');
    const [[previous]] = await conn.execute('SELECT * FROM customer_reviews WHERE orderId=? FOR UPDATE', [orderId]);
    if (!editing && previous) throw err.conflict('该订单已评价客户');
    if (editing && (!previous || previous.engineerId !== engineerId)) throw err.notFound('尚未提交客户评价');
    if (editing && Number(previous.revisionCount) >= 1) throw err.conflict('该评价已修改过，不能再次修改');
    const now = nowIso(), id = previous ? previous.id : newId();
    if (editing) {
      await conn.execute('UPDATE customer_reviews SET score=?,tags=?,content=?,revisionCount=1,revisedAt=?,updatedAt=? WHERE id=?',
        [score, JSON.stringify(tags), content, now, now, id]);
    } else {
      await conn.execute(`INSERT INTO customer_reviews(id,orderId,customerId,engineerId,score,tags,content,createdAt,updatedAt)
        VALUES(?,?,?,?,?,?,?,?,?)`, [id, orderId, order.customerId, engineerId, score, JSON.stringify(tags), content, now, now]);
    }
    return reviewView({ id, score, tags, content, revisionCount: editing ? 1 : 0, createdAt: previous?.createdAt || now, updatedAt: now });
  });
}
module.exports = { saveReview, reviewView };
