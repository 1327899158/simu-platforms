'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let conv = null, available = true, published = 0;
mock('../src/db', {
  query: async (sql, args) => {
    assert.match(sql, /INSERT IGNORE INTO conversations/);
    if (conv) return { affectedRows: 0 };
    conv = { id: args[0], orderId: null, customerId: args[1], engineerId: args[2], directKey: args[5] };
    return { affectedRows: 1 };
  },
  queryOne: async sql => sql.includes('identity_verifications') ? (available ? { id: 'e' } : null) : conv,
});
mock('../src/lib/auth-mw', { requireUser: async req => req.user });
mock('../src/services/chat-svc', { publishConversationDoc: () => published++ });
const { createRouter } = require('../src/lib/http');
const router = createRouter();
require('../src/routes/chat').register(router);
const route = router.match('POST', '/api/engineers/e/conversation');
async function call(user) {
  let body;
  await route.handler({ user }, { writeHead() {}, end(raw) { body=JSON.parse(raw); } }, route.params);
  return body.data;
}
test('客户直接咨询无订单且重复点击复用，只首次推送会话', async () => {
  const first = await call({id:'c',role:'CUSTOMER'});
  const second = await call({id:'c',role:'CUSTOMER'});
  assert.equal(first.id,second.id);
  assert.equal(conv.orderId,null);
  assert.equal(conv.directKey,'c:e');
  assert.equal(published,1);
});
test('工程师不能冒用客户入口，客户不能自聊或向不可用工程师发起咨询', async () => {
  await assert.rejects(call({id:'x',role:'ENGINEER'}),e=>e.status===403);
  await assert.rejects(call({id:'e',role:'CUSTOMER'}),e=>e.status===403);
  available=false;
  await assert.rejects(call({id:'c',role:'CUSTOMER'}),e=>e.status===404);
});
