'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let execute, query, queryOne, statements, audited, adminAllowed;
const db = {
  query: (...args) => query(...args), queryOne: (...args) => queryOne(...args),
  parseJson: value => typeof value === 'string' ? JSON.parse(value) : value || [],
  tx: work => work({ execute: (sql, args) => { statements.push(sql); return execute(sql, args); } }),
};
mock('../src/db', db);
mock('../src/config', { config: { cloudbaseEnv: 'env', env: 'production', uploadMaxBytes: 30000000 } });
mock('../src/tcb', { getStorage: () => { throw new Error('Tests must never call cloud storage'); } });
mock('../src/lib/auth-mw', { requireUser: async req => req.user, requireEngineer: async req => req.user, requireCustomer: async req => req.user });
const { err } = require('../src/lib/http');
mock('../src/lib/admin-mw', {
  requireAdmin: async (_req, permission) => {
    assert.equal(permission, 'INVOICE_PROCESS');
    if (!adminAllowed) throw err.forbidden('无权处理发票');
    return { user: { id: 'admin-user' }, admin: { id: 'admin' } };
  },
  writeAdminAudit: async (...args) => { audited = args; },
});
mock('../src/services/chat-svc', { systemMessageForOrder: async () => { throw new Error('Simulated notification outage'); } });
mock('../src/services/pay-svc', {});
mock('../src/services/dispute-svc', {});
const { createRouter } = require('../src/lib/http');
const router = createRouter();
const { canReadFile } = require('../src/routes/files');
for (const module of ['files', 'orders', 'quotes', 'invoices']) require('../src/routes/' + module).register(router);
beforeEach(() => {
  statements = []; audited = null; adminAllowed = true;
  execute = async sql => { throw new Error('Unexpected execute: ' + sql); };
  query = async sql => { throw new Error('Unexpected query: ' + sql); };
  queryOne = async sql => { throw new Error('Unexpected queryOne: ' + sql); };
});
async function call(method, path, body = {}, user = { id: 'e', role: 'ENGINEER' }, search = '') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.user = user; req.headers = {};
  const route = router.match(method, path); let result;
  await route.handler(req, { writeHead() {}, end(raw) { result = JSON.parse(raw).data; } }, route.params, new URLSearchParams(search));
  return result;
}
test('未知用户不能读取身份证材料、纠纷图片、非头像的未绑定图片', async () => {
  const user = { id: 'stranger' }, file = { id: 'f', uploaderId: 'owner', kind: 'IMAGE', fileID: 'cloud://env.bucket/uploads/owner/img.png' };
  query = async () => [];
  queryOne = async sql => sql.includes('identity_verification_files') ? { fileId: 'f' } : null;
  assert.equal(await canReadFile(user, file), false);
  queryOne = async sql => sql.includes('FROM dispute_evidence') ? { customerId: 'c' } : null;
  assert.equal(await canReadFile(user, file), false);
  queryOne = async () => null;
  assert.equal(await canReadFile(user, file), false);
  queryOne = async sql => sql.includes('avatarUrl') ? { id: 'owner' } : null;
  assert.equal(await canReadFile(user, file), true);
});
test('提交文件不允许冒领其他用户目录或路径穿越', async () => {
  for (const fileID of ['cloud://env.bucket/uploads/other/x.png', 'cloud://env.bucket/uploads/e/../other/x.png']) {
    await assert.rejects(call('POST', '/api/files/commit', { fileID, name: 'x.png', kind: 'IMAGE' }), e => e.status === 403);
  }
  assert.equal(statements.length, 0);
});
test('已发送的聊天文件不能删除，删除检查使用文件行锁', async () => {
  execute = async sql => sql.startsWith('SELECT * FROM uploaded_files') ? [[{ id: 'f', uploaderId: 'e' }]] : [[{ fileId: 'f' }]];
  await assert.rejects(call('DELETE', '/api/files/f'), e => e.status === 409);
  assert.match(statements[0], /FOR UPDATE/);
  assert.equal(statements.some(s => s.startsWith('DELETE')), false);
});
test('交付拒绝空附件、他人的附件和跨订单附件', async () => {
  queryOne = async () => null;
  await assert.rejects(call('POST', '/api/orders/o/deliver', { fileIds: [] }), e => e.status === 400);
  for (const file of [{ id: 'f', uploaderId: 'other' }, { id: 'f', uploaderId: 'e', orderId: 'other-order' }]) {
    execute = async sql => {
      if (sql.startsWith('SELECT * FROM orders')) return [[{ id: 'o', status: 'IN_PROGRESS', selectedQuoteId: 'q' }]];
      if (sql.startsWith('SELECT engineerId')) return [[{ engineerId: 'e' }]];
      if (sql.includes('FROM uploaded_files f')) return [[file]];
      if (sql.startsWith('UPDATE orders')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected SQL: ' + sql);
    };
    await assert.rejects(call('POST', '/api/orders/o/deliver', { fileIds: ['f'] }), e => [403, 409].includes(e.status));
  }
});
test('有效交付同步关联成果文件；通知失败不把交付成功变成接口失败', async () => {
  queryOne = async () => null;
  execute = async sql => {
    if (sql.startsWith('SELECT * FROM orders')) return [[{ id: 'o', selectedQuoteId: 'q' }]];
    if (sql.startsWith('SELECT engineerId')) return [[{ engineerId: 'e' }]];
    if (sql.includes('FROM uploaded_files f')) return [[{ id: 'f', uploaderId: 'e' }]];
    return [{ affectedRows: 1 }];
  };
  const r = await call('POST', '/api/orders/o/deliver', { fileIds: ['f'] });
  assert.equal(r.delivered, true);
  assert.ok(statements.some(sql => sql.includes('INSERT INTO order_attachments') && sql.includes("'RESULT'")));
  assert.match(statements[0], /FOR UPDATE/);
});
test('固定预算订单 PATCH 不能改报价；先锁订单再锁报价', async () => {
  execute = async sql => {
    if (sql.startsWith('SELECT orderId FROM quotes')) return [[{ orderId: 'o' }]];
    if (sql.startsWith('SELECT status,budgetFen')) return [[{ status: 'QUOTING', budgetFen: 380000, budgetFlexible: 0 }]];
    if (sql.startsWith('SELECT * FROM quotes')) return [[{ id: 'q', orderId: 'o', status: 'PENDING' }]];
    throw new Error('Unexpected SQL: ' + sql);
  };
  await assert.rejects(call('PATCH', '/api/quotes/q', { amountFen: 1e6 }), e => e.status === 409);
  assert.match(statements[1], /orders.*FOR UPDATE/);
  assert.match(statements[2], /quotes.*FOR UPDATE/);
});
test('已撤回报价不能被选择，选标顺序为订单锁再报价锁', async () => {
  execute = async sql => {
    if (sql.includes('FROM orders')) return [[{ id: 'o', customerId: 'c', status: 'QUOTING' }]];
    if (sql.includes('FROM quotes')) return [[]];
    throw new Error('Unexpected SQL: ' + sql);
  };
  await assert.rejects(call('POST', '/api/orders/o/select-quote', { quoteId: 'q' }, { id: 'c' }), e => e.status === 409);
  assert.match(statements[0], /orders.*FOR UPDATE/); assert.match(statements[1], /quotes.*FOR UPDATE/);
});
test('工程师不能把平台代开标记完成或绕过发票文件交付', async () => {
  for (const status of ['PLATFORM_REQUESTED', 'SELF_ISSUE']) {
    execute = async () => [[{ id: 'i', engineerId: 'e', status }]];
    await assert.rejects(call('POST', '/api/invoices/i/process', { action: 'ISSUED' }), e => [403, 409].includes(e.status));
  }
});
test('发票分页摘要不受列表上限影响；50 笔以上的批量申请被拒绝', async () => {
  queryOne = async sql => sql.includes('AS amount') ? { count: 101, amount: 101000 } : { total: 101 };
  query = async sql => { assert.match(sql, /LIMIT 50 OFFSET 50/); assert.match(sql, /AND ir.id IS NULL/); return []; };
  const r = await call('GET', '/api/invoices/customer', {}, { id: 'c' }, 'page=2&status=PENDING');
  assert.equal(r.billableCount, 101); assert.equal(r.billableAmountFen, 101000); assert.equal(r.hasMore, true);
  await assert.rejects(call('POST', '/api/invoices/customer/batch', { orderIds: Array.from({ length: 51 }, (_, i) => 'o' + i) }), e => e.status === 400);
});
test('平台交付需管理员处理权限、真实附件并写审计日志', async () => {
  adminAllowed = false;
  await assert.rejects(call('POST', '/api/admin/invoices/i/files', { fileIds: ['f'] }), e => e.status === 403);
  adminAllowed = true;
  execute = async sql => {
    if (sql.includes('SELECT * FROM invoice_requests')) return [[{ id: 'i', orderId: 'o', status: 'PLATFORM_REQUESTED', handlingMode: 'PLATFORM' }]];
    if (sql.includes('FROM uploaded_files f')) return [[{ fileId: 'f', uploaderId: 'admin-user', name: 'invoice.pdf', kind: 'DOC' }]];
    return [{ affectedRows: 1 }];
  };
  query = async () => [{ fileId: 'f', name: 'invoice.pdf' }];
  const result = await call('POST', '/api/admin/invoices/i/files', { fileIds: ['f'] });
  assert.equal(result.status, 'ISSUED');
  assert.equal(result.files[0].fileId, 'f');
  assert.equal(audited[2], 'INVOICE_FILES_DELIVER');
  assert.ok(audited[6].execute);
});
