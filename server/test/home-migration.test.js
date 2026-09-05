'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const migrate = require('../src/services/home-migration');

test('元数据查询不使用 TDSQL 不支持的参数占位符', async () => {
  const calls = [];
  const query = async (sql) => {
    calls.push(sql);
    if (/^SHOW /i.test(sql) && sql.includes('?')) throw new Error('SHOW 中不得使用占位符');
    if (sql.includes("LIKE 'orderId'")) return [{ Null: 'YES' }];
    if (/^SHOW /i.test(sql)) return [{}];
    return { affectedRows: 1 };
  };
  await migrate(query);
  assert.equal(calls.filter(sql => sql.startsWith('SHOW COLUMNS FROM engineer_profiles')).length, 5);
  assert.ok(calls.every(sql => !/^SHOW /i.test(sql) || !sql.includes('?')));
});
