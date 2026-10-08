'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { exports, loaded: true }; };
let actor = 'customer', allowed = true, expired = false, duplicate = false, deadline = null, saved = [], notified = [], updated = [];
mock('../src/lib/auth-mw', { requireUser: async () => ({ id: actor }) });
mock('../src/lib/admin-mw', {});
mock('../src/services/engineer-level', {});
mock('../src/db', {
  queryOne: async () => ({ orderId: 'o' }),
  tx: async fn => fn({ execute: async (sql, args) => {
    if (sql.startsWith('SELECT * FROM disputes')) return [[{ id: 'd', orderId:'o', status: 'OPEN', evidenceDeadlineAt: expired ? new Date(Date.now() - 1).toISOString() : deadline || new Date(Date.now() + 3600000).toISOString() }]];
    if (sql.startsWith('SELECT COUNT')) return [[{ c: 0 }]];
    if (sql.startsWith('SELECT id, uploaderId')) return [args.map(id => ({ id, uploaderId: actor }))];
    if (sql.startsWith('INSERT IGNORE')) { assert.match(sql, /createdAt, description/); saved.push(args); return [{ affectedRows: duplicate ? 0 : 1 }]; }
    if (sql.startsWith('UPDATE disputes')) { updated.push(args); deadline = args[0]; }
    return [{ affectedRows: 1 }];
  } }),
});
mock('../src/services/dispute-svc', { ...require('../src/services/dispute-svc'), isOrderParty: async () => allowed });
mock('../src/services/chat-svc',{ensureConversation:async()=>({id:'conv'}),systemMessage:async(_id,_text,conn,meta)=>{assert.ok(conn);assert.equal(meta.senderId,actor);assert.equal(meta.actionOrderId,'o');return {msgId:1};},publishSystemMessage(_id,text,_mid,meta){notified.push({text,meta});},publishConversationDoc(){}});
const router = createRouter(); require('../src/routes/disputes').register(router);
async function submit(description, fileIds = ['f1', 'f2']) {
  const req = Readable.from([Buffer.from(JSON.stringify({ fileIds, description }))]);
  let response;
  await router.match('POST', '/api/disputes/d/evidence').handler(req, { writeHead() {}, end(body) { response = JSON.parse(body); } }, { id: 'd' });
  return response.data;
}
test('双方可为一批材料填写说明，旧客户端兼容且仍校验举证期限和权限', async () => {
  for (actor of ['customer', 'engineer']) {
    saved = []; notified=[]; await submit('  截图说明\n第二行  ');
    assert.equal(saved.length, 2); assert.equal(notified.length,1);assert.match(notified[0].text,/2份纠纷证据/);
    assert.ok(saved.every(args => args[2] === actor && args[4] === '截图说明\n第二行'));
  }
  saved = []; await submit(); assert.equal(saved[0][4], null);
  saved = []; await submit('十张图片', Array.from({length:10}, (_, i) => 'f' + i)); assert.equal(saved.length, 10);
  await assert.rejects(submit('超限', Array.from({length:11}, (_, i) => 'f' + i)), e => e.status === 400);
  await assert.rejects(submit('x'.repeat(1001)), e => e.status === 400);
  notified=[]; expired = true; await assert.rejects(submit('说明'), e => e.status === 409);
  expired = false; allowed = false; await assert.rejects(submit('说明'), e => e.status === 403); assert.equal(notified.length,0);
});

test('双方交替补充新证据均从本次提交重新计算48小时，重复及失败提交不延长', async () => {
  const originalNow = Date.now;
  let clock = Date.parse('2026-10-08T06:00:00Z');
  Date.now = () => clock;
  try {
    allowed = true; expired = false; duplicate = false; updated = []; notified = [];
    deadline = '2026-10-08 07:00:00';
    actor = 'customer';
    const first = await submit('客户补充', ['new-customer']);
    assert.equal(first.evidenceDeadlineAt, '2026-10-10T06:00:00.000Z');
    assert.equal(first.evidenceRemainingSeconds, 48 * 3600);
    assert.equal(first.evidenceOpen, true);
    assert.equal(first.arbitrationReady, false);
    assert.match(notified.at(-1).text, /重新计算48小时/);
    clock += 47 * 3600 * 1000;
    actor = 'engineer';
    const second = await submit('工程师补充', ['new-engineer']);
    assert.equal(second.evidenceDeadlineAt, '2026-10-12T05:00:00.000Z');
    assert.equal(second.evidenceRemainingSeconds, 48 * 3600);
    const lastDeadline = deadline;
    duplicate = true;
    await assert.rejects(submit('重复提交'), e => e.status === 409);
    duplicate = false;
    allowed = false;
    await assert.rejects(submit('无权限'), e => e.status === 403);
    allowed = true;
    await assert.rejects(submit('重复文件', ['same', 'same']), e => e.status === 400);
    // 新的截止时间到达时仍关闭通道，不允许通过补交重新打开。
    clock += 48 * 3600 * 1000;
    await assert.rejects(submit('截止后提交'), e => e.status === 409);
    assert.equal(deadline, lastDeadline);
    assert.equal(updated.length, 2);
    assert.equal(notified.length, 2);
  } finally { Date.now = originalNow; allowed = true; expired = false; duplicate = false; deadline = null; }
});
