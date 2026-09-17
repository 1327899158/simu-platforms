'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouter, err } = require('../src/lib/http');
let rows = [], queries = [];
function mock(path, exports) {
  require.cache[require.resolve(path)] = { exports, loaded: true };
}
mock('../src/db', { query: async sql => { queries.push(sql); return rows; } });
mock('../src/lib/auth-mw', {});
mock('../src/lib/admin-mw', {
  requireAdmin: async (req, permission) => {
    assert.equal(permission, 'CUSTOMER_SERVICE');
    if (!req.admin) throw err.forbidden();
  },
});
const router = createRouter();
require('../src/routes/customer-service').register(router);
async function list(admin, offset = '0') {
  let result;
  const route = router.match('GET', '/api/admin/service-tickets');
  await route.handler({ admin }, {
    writeHead() {}, end(value) { result = JSON.parse(value).data; },
  }, {}, new URLSearchParams({ offset }));
  return result;
}
test('客服列表兼容不同排序规则，保留昵称、分页和客服权限校验', async () => {
  await assert.rejects(list(false), e => e.status === 403);
  assert.equal(queries.length, 0);
  rows = Array.from({ length: 21 }, (_, i) => ({ id: `t${i}`, nickname: `用户${i}` }));
  const result = await list(true, '20');
  assert.deepEqual(result, { items: rows.slice(0, 20), hasMore: true });
  // 两列都使用同一显式规则，避免 0900_ai_ci 与 unicode_ci 的隐式比较冲突。
  assert.match(queries[0], /u\.id COLLATE utf8mb4_unicode_ci\s*=\s*t\.userId COLLATE utf8mb4_unicode_ci/);
  assert.match(queries[0], /LIMIT 21 OFFSET 20/);
  rows = [];
  assert.deepEqual(await list(true), { items: [], hasMore: false });
  const count = queries.length;
  await assert.rejects(list(true, '0; DROP TABLE users'), e => e.status === 400);
  assert.equal(queries.length, count);
});
