'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let unavailable = false;
mock('../src/db', { queryOne: async (sql, args) => {
  if (sql.includes('FROM conversations')) return args[0] === 'missing' ? null : {customerId:'c', engineerId:'e'};
  return {id:args[0],nickname:'测试',avatarUrl:'',role:args[0]==='e'?'ENGINEER':'CUSTOMER',status:'ACTIVE',deletedAt:unavailable?'2026-01-01':null,phone:'private',passwordHash:'private'};
}});
mock('../src/lib/auth-mw', {requireUser:async req=>req.user});
mock('../src/services/chat-svc', {});
const router = require('../src/lib/http').createRouter();
require('../src/routes/chat').register(router);
async function call(id, conv='conv') {
  const route=router.match('GET','/api/conversations/'+conv+'/peer-profile');
  let body;
  await route.handler({user:{id}}, {writeHead(){},end(raw){body=JSON.parse(raw);}},route.params);
  return body.data;
}
test('双方查看对方资料且仅返回公开字段', async()=>{
  assert.deepEqual(await call('c'),{id:'e',nickname:'测试',avatarUrl:'',role:'ENGINEER'});
  assert.equal((await call('e')).id,'c');
});
test('非参与者和不存在的会话不可访问资料', async()=>{
  await assert.rejects(call('outsider'),e=>e.status===403);
  await assert.rejects(call('c','missing'),e=>e.status===404);
});
test('已注销用户不展示资料', async()=>{
  unavailable=true;
  try {await assert.rejects(call('c'),e=>e.status===404);} finally {unavailable=false;}
});
