'use strict';
// 仅生成未来发奖计划。不得把客户端事件直接传入结算，也不写钱包或优惠券。
const RULES = Object.freeze({ enabled: false, welcomeMinFen: 100000, welcomeDiscountFen: 5000, firstDiscountFen: 3000, inviteRegisterCoins: 50, inviteFirstOrderCoins: 250 });
function planReward({ event, userId, inviterId, eventId, isFirst = false }) {
  if (!userId || !eventId) return [];
  const plans = [];
  const add = (recipient, kind, amount, minSpendFen = 0) => plans.push({
    idempotencyKey: `${event}:${eventId}:${recipient}:${kind}`, recipient, kind, amount, minSpendFen,
    status: 'DEFERRED', affectsPayment: false,
  });
  if (event === 'REGISTERED') {
    add(userId, 'WELCOME_COUPON_FEN', RULES.welcomeDiscountFen, RULES.welcomeMinFen);
    if (inviterId && inviterId !== userId) add(inviterId, 'INVITE_REGISTER_COINS', RULES.inviteRegisterCoins);
  }
  if (event === 'DEMAND_PUBLISHED' && isFirst) add(userId, 'FIRST_COUPON_FEN', RULES.firstDiscountFen);
  if (event === 'ORDER_COMPLETED' && isFirst && inviterId && inviterId !== userId) add(inviterId, 'INVITE_FIRST_ORDER_COINS', RULES.inviteFirstOrderCoins);
  return plans;
}
module.exports = { RULES, planReward };
