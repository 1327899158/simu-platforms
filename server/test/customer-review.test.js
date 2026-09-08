'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let order, review, calls;
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
mock('../src/db', {
  parseJson: x => typeof x === 'string' ? JSON.parse(x) : x || [],
  tx: async work => work({ execute: async (sql, args) => {
    calls.push(sql);
    if (sql.startsWith('SELECT o.')) return [[order]];
    if (sql.startsWith('SELECT * FROM customer_reviews')) return [[review]];
    if (sql.startsWith('INSERT INTO customer_reviews')) review = { id: args[0], engineerId: args[3], revisionCount: 0 };
    else if (sql.startsWith('UPDATE customer_reviews')) review.revisionCount = 1;
    else throw new Error('Unexpected SQL: ' + sql);
    return [{ affectedRows: 1 }];
  } }),
});
const { saveReview, reviewView } = require('../src/services/customer-review-svc');
beforeEach(() => { order = { id: 'o', customerId: 'c', engineerId: 'e', status: 'COMPLETED' }; review = null; calls = []; });
const valid = { score: 5, tags: ['回复及时'], content: '合作愉快' };
test('客户评价首评和唯一一次修改共用订单锁，不能重复提交或重复修改', async () => {
  const result = await saveReview('o', 'e', valid, false);
  assert.deepEqual(result.tags, ['回复及时']);
  assert.match(calls[0], /FOR UPDATE/);
  await assert.rejects(saveReview('o', 'e', valid, false), e => e.status === 409);
  await saveReview('o', 'e', valid, true);
  await assert.rejects(saveReview('o', 'e', valid, true), e => e.status === 409);
});
test('非选中工程师、未完成/已冻结订单均不能评价或修改客户评价', async () => {
  await assert.rejects(saveReview('o', 'other', valid, false), e => e.status === 403);
  order.status = 'DISPUTING';
  await assert.rejects(saveReview('o', 'e', valid, true), e => e.status === 409);
});
test('客户评价拒绝越界评分、伪造和重复标签；返回数组而不是 JSON 字符串', async () => {
  for (const body of [{ ...valid, score: 6 }, { ...valid, tags: ['伪造'] }, { ...valid, tags: ['回复及时', '回复及时'] }]) {
    await assert.rejects(saveReview('o', 'e', body, false), e => e.status === 400);
  }
  assert.deepEqual(reviewView({ score: '5', tags: '["回复及时"]' }).tags, ['回复及时']);
  assert.equal(reviewView(null), null);
});
