'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { exports, loaded: true }; };
let review, inTx = false, failMessage = false;
const messages = [], pushes = [];
const conn = { execute: async (sql, args) => {
  if (sql.includes('SELECT o.id')) return [[{ id: 'o', engineerId: 'e', customerId: 'c', status: 'COMPLETED' }]];
  if (sql.includes('SELECT id FROM engineer_reviews') || sql.includes('SELECT * FROM engineer_reviews WHERE orderId')) return [[review].filter(Boolean)];
  if (sql.includes('INSERT INTO engineer_reviews')) review = { id: args[0], engineerId: 'e', revisionCount: 0, qualityScore: 5, attitudeScore: 5, speedScore: 5 };
  else if (sql.includes('UPDATE engineer_reviews')) review = { ...review, revisionCount: 1 };
  else if (sql.includes('SELECT * FROM engineer_reviews WHERE id')) return [[review]];
  else throw Error(sql);
  return [{ affectedRows: 1 }];
} };
mock('../src/db', { tx: async fn => {
  const before = review, length = messages.length;
  inTx = true;
  try { return await fn(conn); }
  catch (e) { review = before; messages.length = length; throw e; }
  finally { inTx = false; }
} });
mock('../src/lib/auth-mw', { requireCustomer: async () => ({ id: 'c' }) });
mock('../src/lib/admin-mw', {});
mock('../src/services/engineer-level', { refreshLevelSafe: async () => {} });
mock('../src/services/engineer-case-svc', {});
mock('../src/services/customer-review-svc', {});
mock('../src/services/chat-svc', {
  ensureConversation: async (id, connection) => { assert.equal(id, 'o'); assert.equal(connection, conn); return { id: 'conv', engineerId: 'e', _isNew: false }; },
  systemMessage: async (id, content, connection, meta) => {
    assert.equal(inTx, true); assert.equal(connection, conn); assert.equal(id, 'conv');
    assert.deepEqual(meta, { senderId: 'c', actionOrderId: 'o' });
    if (failMessage) throw Error('message failure');
    messages.push(content); return { msgId: messages.length };
  },
  publishSystemMessage: (...args) => { assert.equal(inTx, false); pushes.push(args); },
});
const router = createRouter(); require('../src/routes/reviews').register(router);
async function call(method) {
  const body = { qualityScore: 5, attitudeScore: 5, speedScore: 5, professionalScore: 5, communicationScore: 5 };
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  await router.match(method, '/api/orders/o/review').handler(req, { writeHead() {}, end() {} }, { id: 'o' });
}
test('评价与通知原子保存，重复提交不重复通知，修改评价后再次提醒', async () => {
  failMessage = true;
  await assert.rejects(call('POST'), /message failure/);
  assert.equal(review, undefined); assert.equal(pushes.length, 0);
  failMessage = false; await call('POST');
  assert.equal(messages.length, 1); assert.equal(pushes.length, 1);
  await assert.rejects(call('POST'), e => e.status === 409);
  assert.equal(messages.length, 1);
  await call('PATCH'); assert.equal(messages.length, 2); assert.match(messages[1], /更新/);
  await assert.rejects(call('PATCH'), e => e.status === 409);
  assert.equal(pushes.length, 2);
});
