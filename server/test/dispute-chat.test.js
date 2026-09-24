const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { exports, loaded: true }; };
let party = true, status = 'OPEN', inserted;
mock('../src/db', { queryOne: async () => ({ orderId: 'o' }), tx: async fn => fn({ execute: async (sql, args) => {
  if (sql.startsWith('SELECT')) return [[{ id: 'd', status }]];
  inserted = args; return [{ insertId: 7 }];
} }) });
mock('../src/lib/auth-mw', { requireUser: async () => ({ id: 'c' }) });
mock('../src/lib/admin-mw', {});
mock('../src/services/engineer-level', {});
mock('../src/services/chat-svc', {});
mock('../src/services/dispute-svc', { isOrderParty: async () => party });
const router = createRouter(); require('../src/routes/disputes').register(router);
const call = async content => router.match('POST', '/api/disputes/d/messages').handler(
  Readable.from([Buffer.from(JSON.stringify({ content }))]), { writeHead() {}, end() {} }, { id: 'd' });
test('纠纷交流仅允许当事人在未结案时发送有效文字', async () => {
  await call(' 沟通内容 '); assert.deepEqual(inserted.slice(0, 3), ['d', 'c', '沟通内容']);
  party = false; await assert.rejects(call('你好'), e => e.status === 403);
  party = true; status = 'RESOLVED'; await assert.rejects(call('你好'), e => e.status === 409);
  status = 'OPEN'; await assert.rejects(call('   ')); await assert.rejects(call('字'.repeat(2001)));
});
