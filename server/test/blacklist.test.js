'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const mock = (path,exports) => { require.cache[require.resolve(path)] = { exports,loaded:true }; };
let blocks, target, writes;
const conv = { id:'chat',customerId:'c',engineerId:'e',orderId:'order' };
mock('../src/db', {
  queryOne: async(sql,args) => {
    if (sql.includes('FROM user_blocks')) return blocks.has(args[0]+':'+args[1]) || blocks.has(args[2]+':'+args[3]) ? {ownerId:'x'} : null;
    if (sql.includes('identity_verifications')) return { id:'e' };
    if (sql.includes('FROM conversations')) return conv;
    if (sql.includes('FROM users')) return target;
    throw Error(sql);
  },
  query: async(sql,args) => {
    if (sql.startsWith('INSERT IGNORE INTO user_blocks')) { blocks.add(args[0]+':'+args[1]); return {affectedRows:1}; }
    if (sql.startsWith('DELETE FROM user_blocks')) { blocks.delete(args[0]+':'+args[1]); return {affectedRows:1}; }
    if (sql.includes('FROM user_blocks b')) { assert.deepEqual(args,['c']); assert.doesNotMatch(sql,/phone|password|openid/); return Array.from({length:21},(_,i)=>({id:'e'+i})); }
    if (sql.includes('FROM messages')) return [];
    if (sql.startsWith('UPDATE messages')) return {affectedRows:0};
    writes++; throw Error(sql);
  },
});
mock('../src/lib/auth-mw', { requireUser:async req=>req.user });
mock('../src/services/chat-svc', {});
const svc = require('../src/services/blacklist-svc');
const { createRouter } = require('../src/lib/http');
const router=createRouter();
require('../src/routes/blacklist').register(router);
require('../src/routes/chat').register(router);
async function call(method,path,user={id:'c',role:'CUSTOMER'}) {
  const r=router.match(method,path); let result;
  await r.handler({user},{writeHead(){},end(raw){result=JSON.parse(raw).data;}},r.params,new URLSearchParams());
  return result;
}
beforeEach(()=>{ blocks=new Set();target={id:'e',nickname:'测试工程师',avatarUrl:''};writes=0; });
test('不能拉黑自己、无效用户；重复拉黑幂等',async()=>{
  await assert.rejects(svc.add('c','c'),e=>e.status===400);
  await assert.rejects(svc.add('c',''),e=>e.status===400);
  target=null;await assert.rejects(svc.add('c','missing'),e=>e.status===404);
  target={id:'e'};await svc.add('c','e');await svc.add('c','e');assert.equal(blocks.size,1);
});
test('双向限制；只能删除自己的记录；互相拉黑需分别解除',async()=>{
  await svc.add('c','e');await svc.add('e','c');
  await assert.rejects(svc.assertContact('e','c'),e=>e.status===403);
  await svc.remove('other','e');assert.equal(blocks.size,2);
  await svc.remove('c','e');assert.equal(await svc.blocked('c','e'),true);
  await svc.remove('e','c');assert.equal(await svc.blocked('c','e'),false);
});
test('黑名单分页仅查询本人公开展示字段，拒绝offset注入',async()=>{
  const page=await svc.list('c',0);assert.equal(page.items.length,20);assert.equal(page.nextOffset,20);
  await assert.rejects(svc.list('c','0;DROP TABLE users'),e=>e.status===400);
});
test('客户、工程师可以管理，管理员不能冒用；删除记录以会话身份为准',async()=>{
  await call('POST','/api/blacklist/e');
  await call('POST','/api/blacklist/c',{id:'e',role:'ENGINEER'});
  await call('DELETE','/api/blacklist/e');assert.equal(blocks.has('e:c'),true);
  await assert.rejects(call('GET','/api/blacklist',{id:'admin',role:'ADMIN'}),e=>e.status===403);
});
test('任一方向拉黑拦截直接咨询和所有聊天类型，订单会话也不可绕过',async()=>{
  for(const key of ['c:e','e:c']) {
    blocks=new Set([key]);
    await assert.rejects(call('POST','/api/engineers/e/conversation'),e=>e.status===403);
    await assert.rejects(call('POST','/api/conversations/chat/messages'),e=>e.status===409);
    assert.equal(writes,0);
  }
});
test('拉黑保留历史读取，但返回禁发状态；非参与方仍不可读取',async()=>{
  blocks.add('c:e');
  const result=await call('GET','/api/conversations/chat/messages');
  assert.equal(result.canSend,false);assert.deepEqual(result.items,[]);assert.match(result.sendDisabledReason,/黑名单/);
  await assert.rejects(call('GET','/api/conversations/chat/messages',{id:'outsider',role:'CUSTOMER'}),e=>e.status===403);
});
