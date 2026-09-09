'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
let stats, persisted;
require.cache[require.resolve('../src/db')] = { loaded: true, exports: {
  queryOne: async sql => sql.startsWith('SELECT q.engineerId') ? { engineerId: 'e' } : stats,
  query: async (_sql, args) => { persisted = args; return { affectedRows: 1 }; },
} };
const { calculate, advancement, getLevel, refreshForOrder } = require('../src/services/engineer-level');
beforeEach(() => { stats = { qualified: 1, completed: 9, accepted: 20, reviews: 10, positive: 10, disputed: 0 }; persisted = null; });
test('达到单量后自动更新头衔和数据库缓存，不接受客户端等级值', async () => {
  let level = await getLevel('e'); assert.equal(level.key, 'ROOKIE'); assert.equal(persisted[0], 'ROOKIE');
  stats.completed = 10;
  await refreshForOrder('o'); assert.equal(persisted[0], 'GROWING');
  level = await getLevel('e'); assert.equal(level.advancement.next.key, 'SENIOR');
  stats.positive = 8;
  level = await getLevel('e'); assert.equal(level.key, 'CERTIFIED'); assert.equal(persisted[0], 'CERTIFIED');
});
test('晋级清单显示单量差距，无评价不能伪装好评率达标', () => {
  let progress = advancement(calculate(stats));
  assert.equal(progress.next.key, 'GROWING');
  assert.equal(progress.requirements.find(r => r.key === 'orders').hint, '还差 1 单');
  stats.reviews = 0; stats.positive = 0;
  progress = advancement(calculate(stats));
  assert.equal(progress.requirements.find(r => r.key === 'rating').met, false);
});
test('未具备资质优先提示认证，最高头衔没有下一等级', () => {
  stats.qualified = 0;
  const progress = advancement(calculate(stats));
  assert.equal(progress.next.key, 'CERTIFIED'); assert.equal(progress.requirements[0].met, false);
  stats = { qualified: 1, completed: 120, accepted: 1000, reviews: 100, positive: 98, disputed: 4 };
  assert.equal(advancement(calculate(stats)).next, null);
});
