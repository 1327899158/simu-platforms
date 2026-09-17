'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { exports, loaded: true }; };
let records = [
  { id: 'a', engineerId: 'e', status: 'SELECTED', selectedUnread: 1 },
  { id: 'b', engineerId: 'e', status: 'PENDING', selectedUnread: 1 },
  { id: 'c', engineerId: 'other', status: 'SELECTED', selectedUnread: 1 },
  { id: 'd', engineerId: 'e', status: 'SELECTED', selectedUnread: 1 },
];
mock('../src/db', {
  queryOne: async (sql, [id]) => {
    assert.match(sql, /engineerId=\? AND status='SELECTED' AND selectedUnread=1/);
    return { c: records.filter(x => x.engineerId === id && x.status === 'SELECTED' && x.selectedUnread).length };
  },
  query: async (sql, [userId, ...ids]) => {
    assert.match(sql, /UPDATE quotes SET selectedUnread=0 WHERE engineerId=\? AND status='SELECTED' AND id IN/);
    for (const x of records) if (x.engineerId === userId && x.status === 'SELECTED' && ids.includes(x.id)) x.selectedUnread = 0;
  },
});
mock('../src/lib/auth-mw', { requireUser: async req => req.user });
mock('../src/routes/dicts', {});
mock('../src/services/engineer-level', {});
const router = createRouter();
require('../src/routes/quotes').register(router);
async function call(method, suffix, body = {}, role = 'ENGINEER') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.user = { id: 'e', role };
  let data;
  const route = router.match(method, '/api/quotes/mine/' + suffix);
  await route.handler(req, { writeHead() {}, end(raw) { data = JSON.parse(raw).data; } });
  return data;
}
test('仅本人选中报价触发提醒，已读不影响他人或尚未查看的报价，再次选中可提醒', async () => {
  assert.equal((await call('GET', 'unread')).unreadCount, 2);
  await assert.rejects(call('POST', 'mark-read', { ids: ['a'] }, 'CUSTOMER'), e => e.status === 403);
  await call('POST', 'mark-read', { ids: ['a', 'c'] });
  assert.equal(records[2].selectedUnread, 1);
  assert.equal((await call('GET', 'unread')).unreadCount, 1);
  records[0].selectedUnread = 1;
  assert.equal((await call('GET', 'unread')).unreadCount, 2);
  await assert.rejects(call('POST', 'mark-read', { ids: 'a' }), e => e.status === 400);
});

test('报价列表加载失败不清除提醒，成功后仅标记可见的选中报价', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let page, fail = true, marked;
  const request = async (method, url, body) => {
    if (method === 'POST') { marked = body.ids; return {}; }
    if (fail) throw Error('offline');
    return { items: [
      { id: 'a', status: 'SELECTED', order: { status: 'DELIVERED' } },
      { id: 'b', status: 'SELECTED', order: { status: 'IN_PROGRESS' } },
      { id: 'c', status: 'PENDING' },
    ], counts: {} };
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages/my-quotes/index.js'), 'utf8'), {
    Page: value => { page = value; }, wx: { showToast() {} },
    require: name => name.endsWith('/request') ? { request } : { fenToYuan: () => '', timeShort: () => '' },
  });
  page.setData = patch => Object.assign(page.data, patch);
  await page.load(); assert.equal(marked, undefined);
  fail = false; page.data.tab = 'DELIVERED';
  await page.load(); assert.deepEqual(Array.from(marked), ['a']);
  page.data.tab = '';
  await page.load(); assert.deepEqual(Array.from(marked), ['a', 'b']);
});
