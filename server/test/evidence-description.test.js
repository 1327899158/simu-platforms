'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { exports, loaded: true }; };
let actor = 'customer', allowed = true, expired = false, saved = [];
mock('../src/lib/auth-mw', { requireUser: async () => ({ id: actor }) });
mock('../src/lib/admin-mw', {});
mock('../src/services/engineer-level', {});
mock('../src/services/dispute-svc', { isOrderParty: async () => allowed });
mock('../src/db', {
  queryOne: async () => ({ orderId: 'o' }),
  tx: async fn => fn({ execute: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM disputes')) return [[{ id: 'd', status: 'OPEN', evidenceDeadlineAt: new Date(Date.now() + (expired ? -1 : 3600000)).toISOString() }]];
    if (sql.startsWith('SELECT COUNT')) return [[{ c: 0 }]];
    if (sql.startsWith('SELECT id, uploaderId')) return [args.map(id => ({ id, uploaderId: actor }))];
    if (sql.startsWith('INSERT IGNORE')) { assert.match(sql, /createdAt, description/); saved.push(args); }
    return [{ affectedRows: 1 }];
  } }),
});
const router = createRouter(); require('../src/routes/disputes').register(router);
async function submit(description) {
  const req = Readable.from([Buffer.from(JSON.stringify({ fileIds: ['f1', 'f2'], description }))]);
  await router.match('POST', '/api/disputes/d/evidence').handler(req, { writeHead() {}, end() {} }, { id: 'd' });
}
test('双方可为一批材料填写说明，旧客户端兼容且仍校验举证期限和权限', async () => {
  for (actor of ['customer', 'engineer']) {
    saved = []; await submit('  截图说明\n第二行  ');
    assert.equal(saved.length, 2);
    assert.ok(saved.every(args => args[2] === actor && args[4] === '截图说明\n第二行'));
  }
  saved = []; await submit(); assert.equal(saved[0][4], null);
  await assert.rejects(submit('x'.repeat(1001)), e => e.status === 400);
  expired = true; await assert.rejects(submit('说明'), e => e.status === 409);
  expired = false; allowed = false; await assert.rejects(submit('说明'), e => e.status === 403);
});
