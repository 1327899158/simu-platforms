'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let order, identity, existing, count, inserted, calls, deleted, publicRows;
mock('../src/db', {
  parseJson: x => typeof x === 'string' ? JSON.parse(x) : x || [],
  tx: async work => work({ execute: async (sql, args) => {
    calls.push(sql);
    if (sql.includes('SELECT userId FROM engineer_profiles')) return [[{ userId: 'e' }]];
    if (sql.includes('FROM orders o')) return [[order]];
    if (sql.includes('FROM identity_verifications')) return [[{ verifyStatus: identity }]];
    if (sql.includes('SELECT id,orderId FROM engineer_cases')) return [[existing].filter(Boolean)];
    if (sql.includes('COUNT(*)')) return [[{ total: count }]];
    if (sql.startsWith('INSERT INTO engineer_cases') || sql.startsWith('UPDATE engineer_cases')) { inserted = args; return [{ affectedRows: 1 }]; }
    throw new Error('Unexpected SQL: ' + sql);
  } }),
  queryOne: async sql => { calls.push(sql); return { total: publicRows.length }; },
  query: async (sql, args) => {
    calls.push(sql);
    if (sql.startsWith('DELETE')) { assert.deepEqual(args, ['case', 'e']); return { affectedRows: deleted ? 1 : 0 }; }
    return publicRows;
  },
});
const svc = require('../src/services/engineer-case-svc');
beforeEach(() => {
  order = { id: 'o', engineerId: 'e', status: 'COMPLETED', deletedAt: null };
  identity = 'APPROVED'; existing = null; count = 0; inserted = null; calls = []; deleted = true; publicRows = [];
});
const body = { orderId: 'o', title: '公开结构案例', summary: '采用有限元方法评估结构强度并整理交付报告。', confirmPublic: true };
test('案例只能由选中工程师添加已完成订单，非完成或删除状态均拒绝', async () => {
  for (const status of ['QUOTING', 'IN_PROGRESS', 'DELIVERED', 'DISPUTING', 'CANCELLED', 'CLOSED']) {
    order.status = status;
    await assert.rejects(svc.saveCase('e', body), e => e.status === 409);
  }
  order.status = 'COMPLETED'; order.engineerId = 'other';
  await assert.rejects(svc.saveCase('e', body), e => e.status === 403);
  order.engineerId = 'e'; order.deletedAt = '2026-09-08';
  await assert.rejects(svc.saveCase('e', body), e => e.status === 403);
  assert.equal(inserted, null);
});
test('展示必须确认公开授权并通过认证，拒绝空标题或无介绍', async () => {
  for (const invalid of [{ ...body, confirmPublic: false }, { ...body, title: '' }, { ...body, summary: '过短' }]) {
    await assert.rejects(svc.saveCase('e', invalid), e => e.status === 400);
  }
  identity = 'REJECTED';
  await assert.rejects(svc.saveCase('e', body), e => e.status === 403);
});
test('案例首建、唯一性、归属检查、编辑及总量限制', async () => {
  const result = await svc.saveCase('e', body);
  assert.equal(result.title, body.title); assert.equal(inserted[1], 'e'); assert.equal(inserted[2], 'o');
  assert.match(calls[0], /FOR UPDATE/);
  existing = { id: result.id, orderId: 'o' };
  await assert.rejects(svc.saveCase('e', body), e => e.status === 409);
  await assert.rejects(svc.saveCase('e', body, 'other-case'), e => e.status === 404);
  await svc.saveCase('e', { ...body, title: '更新公开标题' }, result.id);
  assert.equal(inserted[0], '更新公开标题');
  existing = null; count = 40;
  await assert.rejects(svc.saveCase('e', body), e => e.status === 409);
});
test('公开案例字段白名单：不暴露客户、金额、原始需求或云文件', async () => {
  publicRows = [{ id: 'case', title: '公开标题', summary: '公开介绍', directionTags: '["结构分析"]', softwareTags: '[]', completedAt: '2026-09-08 00:00:00', orderId: 'secret-order', customerId: 'secret-customer', finalAmountFen: 100000, fileID: 'cloud://private', description: '保密描述' }];
  const result = await svc.publicCases('e');
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['id', 'title', 'summary', 'directions', 'softwares', 'completedMonth'].sort());
  assert.equal(result.items[0].completedMonth, '2026-09');
  assert.match(calls[0], /o.status='COMPLETED'/); assert.match(calls[0], /iv.verifyStatus='APPROVED'/);
  assert.match(calls[0], /q.engineerId=ec.engineerId/); assert.match(calls[0], /u.status='ACTIVE'/);
  await assert.rejects(svc.publicCases('e', '0; DROP TABLE orders'), e => e.status === 400);
});
test('移除仅使用本人案例条件，原订单和文件不执行删除', async () => {
  assert.equal((await svc.removeCase('e', 'case')).removed, true);
  assert.equal(calls.length, 1); assert.match(calls[0], /WHERE id=\? AND engineerId=\?/);
  deleted = false;
  await assert.rejects(svc.removeCase('e', 'case'), e => e.status === 404);
});
