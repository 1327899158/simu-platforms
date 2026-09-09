'use strict';
const { query, queryOne, tx, parseJson } = require('../db');
const { err } = require('../lib/http');
const { v, newId, nowIso } = require('../lib/util');
const MAX_CASES = 40;

// 公开数据使用白名单：不返回 orderId、客户、订单金额、原始需求或文件。
function publicView(row) {
  return { id: row.id, title: row.title, summary: row.summary,
    directions: parseJson(row.directionTags), softwares: parseJson(row.softwareTags),
    completedMonth: row.completedAt ? String(row.completedAt).slice(0, 7) : '' };
}
const publicFrom = `FROM engineer_cases ec JOIN orders o ON o.id=ec.orderId
  JOIN quotes q ON q.id=o.selectedQuoteId AND q.engineerId=ec.engineerId
  JOIN users u ON u.id=ec.engineerId JOIN identity_verifications iv ON iv.userId=u.id
  WHERE ec.engineerId=? AND o.status='COMPLETED' AND o.deletedAt IS NULL
    AND u.role='ENGINEER' AND u.status='ACTIVE' AND u.deletedAt IS NULL AND iv.verifyStatus='APPROVED'`;

async function publicCases(engineerId, offset = 0, limit = 6) {
  offset = v.int(offset, 'offset', { min: 0, max: 100000 });
  limit = v.int(limit, 'limit', { min: 1, max: 20 });
  const count = await queryOne(`SELECT COUNT(*) AS total ${publicFrom}`, [engineerId]);
  const rows = await query(`SELECT ec.id,ec.title,ec.summary,o.directionTags,o.softwareTags,o.completedAt
    ${publicFrom} ORDER BY ec.createdAt DESC,ec.id DESC LIMIT ${limit} OFFSET ${offset}`, [engineerId]);
  const total = Number(count?.total || 0);
  return { items: rows.map(publicView), total, nextOffset: offset + rows.length < total ? offset + rows.length : null };
}

async function ownCases(engineerId) {
  const rows = await query(`SELECT ec.*,o.projectName,o.status AS orderStatus,o.completedAt,
      (o.status='COMPLETED' AND o.deletedAt IS NULL AND q.engineerId=ec.engineerId
       AND iv.verifyStatus='APPROVED') AS visible
    FROM engineer_cases ec JOIN orders o ON o.id=ec.orderId
    LEFT JOIN quotes q ON q.id=o.selectedQuoteId
    LEFT JOIN identity_verifications iv ON iv.userId=ec.engineerId
    WHERE ec.engineerId=? ORDER BY ec.createdAt DESC,ec.id DESC LIMIT ${MAX_CASES}`, [engineerId]);
  return { items: rows.map(r => ({ ...r, visible: !!Number(r.visible) })), maxCases: MAX_CASES };
}

async function candidates(engineerId, offset = 0) {
  offset = v.int(offset, 'offset', { min: 0, max: 100000 });
  const rows = await query(`SELECT o.id,o.projectName,o.completedAt,ec.id AS caseId
    FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId
    LEFT JOIN engineer_cases ec ON ec.orderId=o.id AND ec.engineerId=q.engineerId
    WHERE q.engineerId=? AND o.status='COMPLETED' AND o.deletedAt IS NULL
    ORDER BY o.completedAt DESC,o.id DESC LIMIT 21 OFFSET ${offset}`, [engineerId]);
  return { items: rows.slice(0, 20), nextOffset: rows.length > 20 ? offset + 20 : null };
}

async function saveCase(engineerId, body, caseId = null) {
  const title = v.str(body.title, '公开标题', { min: 2, max: 80 });
  const summary = v.str(body.summary, '案例介绍', { min: 10, max: 1500 });
  if (body.confirmPublic !== true) throw err.bad('请确认展示内容不含客户机密且已获得必要的展示授权');
  const orderId = v.str(body.orderId, '订单ID', { min: 1, max: 32 });
  return tx(async conn => {
    // 同一工程师串行创建，限制总量，重复添加由唯一键与锁内检查共同阻止。
    const [[profile]] = await conn.execute('SELECT userId FROM engineer_profiles WHERE userId=? FOR UPDATE', [engineerId]);
    if (!profile) throw err.forbidden('工程师资料不存在');
    const [[order]] = await conn.execute(`SELECT o.id,o.status,o.deletedAt,q.engineerId
      FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=? FOR UPDATE`, [orderId]);
    if (!order || order.deletedAt || order.engineerId !== engineerId) throw err.forbidden('只能展示本人承接的订单');
    if (order.status !== 'COMPLETED') throw err.conflict('仅已完成订单可以添加或修改案例');
    const [[identity]] = await conn.execute('SELECT verifyStatus FROM identity_verifications WHERE userId=?', [engineerId]);
    if (identity?.verifyStatus !== 'APPROVED') throw err.forbidden('请先完成身份认证');
    const [[existing]] = await conn.execute('SELECT id,orderId FROM engineer_cases WHERE engineerId=? AND orderId=? FOR UPDATE', [engineerId, orderId]);
    if (caseId && (!existing || existing.id !== caseId)) throw err.notFound('案例不存在或不属于当前工程师');
    if (!caseId && existing) throw err.conflict('该订单已添加为案例，请直接编辑');
    const id = caseId || newId(), now = nowIso();
    if (caseId) {
      await conn.execute('UPDATE engineer_cases SET title=?,summary=?,updatedAt=? WHERE id=? AND engineerId=?', [title, summary, now, id, engineerId]);
    } else {
      const [[count]] = await conn.execute('SELECT COUNT(*) AS total FROM engineer_cases WHERE engineerId=?', [engineerId]);
      if (Number(count.total) >= MAX_CASES) throw err.conflict(`最多展示 ${MAX_CASES} 个案例，请先移除旧案例`);
      await conn.execute('INSERT INTO engineer_cases(id,engineerId,orderId,title,summary,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?)', [id, engineerId, orderId, title, summary, now, now]);
    }
    return { id, title, summary };
  });
}
async function removeCase(engineerId, caseId) {
  const result = await query('DELETE FROM engineer_cases WHERE id=? AND engineerId=?', [caseId, engineerId]);
  if (!result.affectedRows) throw err.notFound('案例不存在');
  return { removed: true };
}
module.exports = { publicView, publicCases, ownCases, candidates, saveCase, removeCase };
