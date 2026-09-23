'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const mock = (p, exports) => { require.cache[require.resolve(p)] = { loaded: true, exports }; };
let file, evidence = false, signed = 0;
mock('../src/config', { config: { uploadMaxBytes: 30000000 } });
mock('../src/lib/auth-mw', { requireUser: async req => req.user });
mock('../src/tcb', { getStorage: () => ({ getTempFileURL: async () => {
  signed++; return { fileList: [{ tempFileURL: 'https://storage.example/signed' }] };
} }) });
mock('../src/db', {
  query: async () => [],
  queryOne: async sql => {
    if (sql.includes('SELECT f.*, oa.purpose')) return file;
    if (sql.includes('FROM dispute_evidence')) return evidence ? { customerId: 'customer', selectedQuoteId: 'q' } : null;
    if (sql.includes('SELECT engineerId FROM quotes')) return { engineerId: 'engineer' };
    if (sql.includes('SELECT * FROM orders')) return { id: 'o', customerId: 'customer', selectedQuoteId: 'q' };
    return null;
  },
  tx: async fn => fn({ execute: async (sql, args) => {
    if (sql.startsWith('INSERT INTO uploaded_files')) {
      assert.equal((sql.match(/\?/g) || []).length, args.length);
      const [id, orderId, uploaderId, kind, name, fileID, mime, createdAt, netdiskUrl, netdiskPassword] = args;
      file = { id, orderId, uploaderId, kind, name, fileID, mime, createdAt, netdiskUrl, netdiskPassword };
    }
    return [{}];
  } }),
});
const router = require('../src/lib/http').createRouter();
require('../src/routes/files').register(router);
async function call(method, url, userId, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.user = { id: userId };
  const route = router.match(method, url); let data;
  await route.handler(req, { writeHead() {}, end(s) { data = JSON.parse(s).data; } }, route.params, new URLSearchParams());
  return data;
}
test('网盘登记保存链接和提取码，读取需要附件权限，不能向其他人的订单登记', async () => {
  const created = await call('POST', '/api/files/netdisk', 'engineer', { url: 'https://pan.example/share', password: 'abcd' });
  assert.ok(created.id); assert.equal(created.netdiskPassword, undefined);
  assert.equal((await call('GET', '/api/files/' + created.id + '/url', 'engineer')).netdiskPassword, 'abcd');
  await assert.rejects(call('GET', '/api/files/' + created.id + '/url', 'stranger'), e => e.status === 403);
  await assert.rejects(call('POST', '/api/files/netdisk', 'stranger', { orderId: 'o', url: 'https://pan.example/share' }), e => e.status === 403);
});
test('带订单关联的纠纷证据可供双方读取，陌生人不可读取且不会获签名地址', async () => {
  evidence = true; signed = 0;
  file = { id: 'f', orderId: 'o', uploaderId: 'customer', kind: 'DOC', fileID: 'cloud://env/file.pdf', name: 'file.pdf' };
  assert.match((await call('GET', '/api/files/f/url', 'engineer')).url, /signed/);
  assert.equal(signed, 1);
  await assert.rejects(call('GET', '/api/files/f/url', 'stranger'), e => e.status === 403);
  assert.equal(signed, 1);
  file.netdiskUrl = 'https://pan.example/share'; file.netdiskPassword = '1234';
  assert.equal((await call('GET', '/api/files/f/url', 'engineer')).netdiskPassword, '1234');
  assert.equal(signed, 1);
});
