'use strict';
const { query, queryOne } = require('../db');
const { err } = require('../lib/http');
const { v, nowIso } = require('../lib/util');
async function blocked(a, b) {
  return !!await queryOne('SELECT ownerId FROM user_blocks WHERE (ownerId=? AND blockedUserId=?) OR (ownerId=? AND blockedUserId=?) LIMIT 1', [a,b,b,a]);
}
async function assertContact(a, b) {
  if (await blocked(a,b)) throw err.forbidden('当前无法沟通：存在黑名单限制，可在“我的→黑名单”管理');
}
async function add(ownerId, targetId) {
  targetId = v.str(targetId, '用户ID', { min: 1, max: 32 });
  if (ownerId === targetId) throw err.bad('不能拉黑自己');
  const target = await queryOne("SELECT id FROM users WHERE id=? AND role IN ('CUSTOMER','ENGINEER') AND deletedAt IS NULL", [targetId]);
  if (!target) throw err.notFound('用户不存在或不可拉黑');
  await query('INSERT IGNORE INTO user_blocks(ownerId,blockedUserId,createdAt) VALUES(?,?,?)', [ownerId,targetId,nowIso()]);
  return { blocked: true };
}
async function remove(ownerId, targetId) {
  await query('DELETE FROM user_blocks WHERE ownerId=? AND blockedUserId=?', [ownerId,targetId]);
  return { blocked: false };
}
async function list(ownerId, offset=0) {
  offset = v.int(offset, 'offset', { min: 0, max: 1000000 });
  const rows = await query(`SELECT b.blockedUserId AS id,b.createdAt,u.nickname,u.avatarUrl,u.role FROM user_blocks b LEFT JOIN users u ON u.id=b.blockedUserId WHERE b.ownerId=? ORDER BY b.createdAt DESC,b.blockedUserId LIMIT 21 OFFSET ${offset}`, [ownerId]);
  return { items: rows.slice(0,20), nextOffset: rows.length > 20 ? offset+20 : null };
}
module.exports = { blocked, assertContact, add, remove, list };
