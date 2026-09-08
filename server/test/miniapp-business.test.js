'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function page(file, request) {
  let definition;
  const source = fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages', file, 'index.js'), 'utf8');
  const wx = { showToast() {}, setNavigationBarTitle() {}, navigateBack() {} };
  vm.runInNewContext(source, {
    Page: p => { definition = p; }, wx, setTimeout: () => {},
    require: name => name.endsWith('/auth') ? { ensureLogin: () => ({ id: 'e', role: 'ENGINEER' }) } : { request },
  });
  definition.data = JSON.parse(JSON.stringify(definition.data));
  definition.setData = patch => Object.assign(definition.data, patch);
  return definition;
}
test('评价客户页面显示元金额，已有评价自动使用修改接口', async () => {
  let method;
  const p = page('customer-review-form', async m => {
    method = m;
    return { status: 'COMPLETED', iAmSelected: true, finalAmountFen: 380000, customer: { nickname: '李先生' }, customerReview: { score: 5, tags: ['回复及时'], revisionCount: 0 } };
  });
  await p.onLoad({ orderId: 'o' });
  assert.equal(p.data.order.finalY, '3800.00'); assert.equal(p.data.editing, true);
  await p.submit(); assert.equal(method, 'PATCH');
});
test('批量开票仅提交勾选的订单，重复点击在处理中不重复提交', async () => {
  let submitted, release, count = 0;
  const p = page('invoices', async (method, url, body) => {
    if (method === 'POST') { submitted = body; count++; await new Promise(resolve => { release = resolve; }); return {}; }
    return { items: [] };
  });
  p.setData({ role: 'CUSTOMER', batchTitle: '测试公司', batchIds: ['o2'], items: [{ status: 'PENDING', orderId: 'o1' }, { status: 'PENDING', orderId: 'o2' }] });
  const pending = p.submitBatch();
  await p.submitBatch(); assert.equal(count, 1);
  assert.equal(JSON.stringify(submitted.orderIds), '["o2"]');
  release(); await pending;
});
