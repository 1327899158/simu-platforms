'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function loadPage(name, request) {
  let page; const nav = [], toasts = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages', name, 'index.js'), 'utf8'), {
    Page: p => { page = p; },
    require: target => target.endsWith('/auth') ? { ensureLogin: () => ({ id: 'e', role: 'ENGINEER' }) } : { request },
    wx: { showToast: x => toasts.push(x), setNavigationBarTitle() {}, navigateTo: x => nav.push(x), navigateBack() {}, showModal: x => x.success({ confirm: true }) },
  });
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
  return { page, nav, toasts };
}
test('选择完成订单不自动复制客户项目标题或原文，确认公开后才提交', async () => {
  const calls = [];
  const { page } = loadPage('engineer-cases', async (...args) => { calls.push(args); return { items: [], maxCases: 40 }; });
  page.setData({ candidates: [{ id: 'o', projectName: '客户保密项目名称', description: '机密' }] });
  page.choose({ currentTarget: { dataset: { id: 'o' } } });
  assert.equal(page.data.title, ''); assert.equal(page.data.summary, ''); assert.equal(page.data.orderId, 'o');
  page.setData({ title: '公开案例', summary: '对结构进行有限元分析并输出交付报告。' });
  await page.save(); assert.equal(calls.length, 0);
  page.setData({ confirmed: true });
  await page.save(); assert.equal(calls[0][0], 'POST');
  assert.equal(calls[0][2].confirmPublic, true); assert.equal(calls[0][2].orderId, 'o');
  assert.equal(calls[0][2].description, undefined);
});
test('编辑复用原案例ID，移除只调用案例端点', async () => {
  const calls = [];
  const { page } = loadPage('engineer-cases', async (...args) => { calls.push(args); return { items: [], maxCases: 40 }; });
  page.setData({ items: [{ id: 'case', orderId: 'o', title: '原案例标题', summary: '原案例介绍包含公开的方法和成果。' }] });
  page.edit({ currentTarget: { dataset: { id: 'case' } } });
  page.setData({ confirmed: true }); await page.save();
  assert.equal(calls[0][0], 'PATCH'); assert.equal(calls[0][1], '/engineers/me/cases/case');
  calls.length = 0;
  await page.remove({ currentTarget: { dataset: { id: 'case' } } });
  assert.equal(calls[0][0], 'DELETE'); assert.equal(calls[0][1], '/engineers/me/cases/case');
});
test('公开资料加载等级及首批案例，更多案例追加，不跳转原订单', async () => {
  const calls = [];
  const { page } = loadPage('engineer-profile', async (...args) => {
    calls.push(args);
    if (args[1].endsWith('/profile')) return { nickname: '测试工程师', level: { key: 'GROWING' }, cases: { items: [{ id: 'c1' }], total: 7, nextOffset: 6 } };
    return { items: [{ id: 'c2' }], total: 7, nextOffset: null };
  });
  page.onLoad({ id: 'e' }); await page.load();
  assert.equal(page.data.profile.level.key, 'GROWING'); assert.equal(page.data.caseTotal, 7);
  await page.moreCases(); assert.equal(page.data.cases.length, 2); assert.equal(page.data.nextOffset, null);
  assert.equal(calls[1][1], '/engineers/e/cases?offset=6');
});
test('客户点击入口存在，沟通按钮阻止事件冒泡，个人信息均有等级标签', () => {
  for (const file of ['home', 'engineer-directory']) {
    const markup = fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages', file, 'index.wxml'), 'utf8');
    assert.match(markup, /bindtap="open(Engineer|Profile)"/);
    assert.match(markup, /catchtap="contact(Engineer)?"/);
    assert.match(markup, /engineer-level-tag/);
  }
});
test('自动建表定义与控制台单条 SQL 一致', () => {
  const ddl = fs.readFileSync(path.resolve(__dirname, '../src/db.js'), 'utf8');
  const sql = fs.readFileSync(path.resolve(__dirname, '../../docs/engineer-cases-table.sql'), 'utf8');
  const pattern = /CREATE TABLE IF NOT EXISTS engineer_cases \([\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/;
  assert.equal(ddl.match(pattern)[0].replace(/\s+/g, ' '), sql.match(pattern)[0].replace(/\s+/g, ' '));
});
