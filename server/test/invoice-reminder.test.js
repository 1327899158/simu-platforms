'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('发票提醒仅面向成交工程师，处理中状态准确且重复刷新不重复提示', async () => {
  let page, status = 'REQUESTED', selected = true, failed = false;
  const toasts = [];
  const request = async (_method, url) => {
    if (url === '/market/orders/o') return { iAmSelected: selected, status: 'COMPLETED' };
    if (url.endsWith('/invoice-request')) {
      if (failed) throw Error('offline');
      return status ? { id: 'i', status, invoiceTitle: '测试企业' } : null;
    }
    if (url.endsWith('/files') || url.endsWith('/quotes')) return [];
    return null;
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages/order-detail/index.js'), 'utf8'), {
    Page: p => { page = p; }, wx: { showToast: v => toasts.push(v) },
    require: name => name.endsWith('/request') ? { request } : name.endsWith('/format')
      ? { fenToYuan: () => '', timeShort: () => '', STATUS_CLASS: {} } : {},
  });
  page.setData = patch => Object.assign(page.data, patch);
  Object.assign(page.data, { id: 'o', mode: 'market', role: 'ENGINEER' });
  await page.load(); assert.equal(page.data.invoiceNeedsAction, true); assert.equal(toasts.length, 1);
  await page.load(); assert.equal(toasts.length, 1);
  status = 'SELF_ISSUE'; await page.load(); assert.equal(page.data.invoiceNeedsAction, true); assert.equal(toasts.length, 2);
  for (status of ['PLATFORM_REQUESTED', 'ISSUED', 'REJECTED', null]) {
    await page.load(); assert.equal(page.data.invoiceNeedsAction, false);
  }
  status = 'REQUESTED'; selected = false;
  await page.load(); assert.equal(page.data.invoiceNeedsAction, false);
  selected = true; page.data.role = 'CUSTOMER';
  await page.load(); assert.equal(page.data.invoiceNeedsAction, false);
  page.data.role = 'ENGINEER'; failed = true;
  await page.load(); assert.equal(page.data.invoiceNeedsAction, false);
  assert.equal(toasts.length, 2);
});
