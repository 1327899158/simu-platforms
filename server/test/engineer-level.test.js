'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculate } = require('../src/services/engineer-level');
const base = { qualified: 1, completed: 0, reviews: 100, positive: 100, accepted: 1000, disputed: 0 };
test('资质是所有等级的前提，无评价不能升级', () => {
  assert.equal(calculate({...base, qualified:0, completed:120}).key, 'UNQUALIFIED');
  assert.equal(calculate({...base, completed:120, reviews:0, positive:0}).key, 'CERTIFIED');
  assert.equal(calculate({...base, reviews:0}).positiveRate, null);
});
test('完成单量分界与好评率边界', () => {
  for (const [completed,positive,key] of [[0,100,'CERTIFIED'],[1,85,'ROOKIE'],[9,90,'ROOKIE'],[10,90,'GROWING'],[29,100,'GROWING'],[30,95,'SENIOR'],[59,100,'SENIOR'],[60,97,'GOLD'],[119,100,'GOLD'],[120,98,'CHIEF'],[120,84,'CERTIFIED']]) {
    assert.equal(calculate({...base,completed,positive}).key,key, `${completed} 单 / ${positive}%`);
  }
});
test('纠纷率严格小于门槛，不对四舍五入后的数值判级', () => {
  assert.equal(calculate({...base,completed:30,disputed:20}).key,'GROWING');
  assert.equal(calculate({...base,completed:60,disputed:10}).key,'SENIOR');
  assert.equal(calculate({...base,completed:120,disputed:5}).key,'GOLD');
  assert.equal(calculate({...base,completed:120,disputed:4}).key,'CHIEF');
  assert.equal(calculate({...base,completed:120,reviews:10001,positive:9800}).key,'GOLD');
});
