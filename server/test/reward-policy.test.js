'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RULES, planReward } = require('../src/services/reward-policy');
test('奖励计划暂不入账或影响支付，事件可幂等', () => {
  const input={event:'REGISTERED',userId:'u',inviterId:'v',eventId:'registration-u'};
  const plans=planReward(input);
  assert.equal(RULES.enabled,false);
  assert.deepEqual(plans,planReward(input));
  assert.equal(plans.length,2);
  assert.equal(plans[0].amount,5000);
  assert.equal(plans[0].minSpendFen,100000);
  assert.equal(plans[1].amount,50);
  assert.ok(plans.every(p=>p.status==='DEFERRED'&&!p.affectsPayment));
});
test('首单条件与禁止自邀', () => {
  assert.equal(planReward({event:'ORDER_COMPLETED',userId:'u',inviterId:'v',eventId:'o',isFirst:true})[0].amount,250);
  assert.deepEqual(planReward({event:'ORDER_COMPLETED',userId:'u',inviterId:'v',eventId:'o'}),[]);
  assert.deepEqual(planReward({event:'ORDER_COMPLETED',userId:'u',inviterId:'u',eventId:'o',isFirst:true}),[]);
  assert.equal(planReward({event:'DEMAND_PUBLISHED',userId:'u',eventId:'o',isFirst:true})[0].amount,3000);
});
