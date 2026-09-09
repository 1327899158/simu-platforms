'use strict';
const { query, queryOne } = require('../db');
const LEVELS = [
  { key: 'CERTIFIED', name: '认证工程师', icon: '✓', min: 0, positive: 0, dispute: null, rate: null, weight: 0, rule: '实名认证通过 + 已提交基础资质资料（0单起步）' },
  { key: 'ROOKIE', name: '新秀工程师', icon: '🆕', min: 1, positive: 85, dispute: null, rate: 15, weight: 0, rule: '累计1–9单，好评率≥85%' },
  { key: 'GROWING', name: '成长工程师', icon: '📈', min: 10, positive: 90, dispute: null, rate: 10, weight: 0, rule: '累计10–29单，好评率≥90%' },
  { key: 'SENIOR', name: '资深工程师', icon: '💎', min: 30, positive: 95, dispute: 2, rate: 8, weight: 0, rule: '累计30–59单，好评率≥95%，纠纷率<2%' },
  { key: 'GOLD', name: '金牌交付工程师', icon: '🏆', min: 60, positive: 97, dispute: 1, rate: 8, weight: 1, rule: '累计60–119单，好评率≥97%，纠纷率<1%；享报价曝光优先' },
  { key: 'CHIEF', name: '首席工程师', icon: '👑', min: 120, positive: 98, dispute: 0.5, rate: 8, weight: 2, rule: '累计120单以上，好评率≥98%，纠纷率<0.5%；享更高曝光权重' },
];
function calculate(stats) {
  const positiveRate = stats.reviews ? stats.positive / stats.reviews * 100 : null;
  const disputeRate = stats.accepted ? stats.disputed / stats.accepted * 100 : 0;
  let level = { key: 'UNQUALIFIED', name: '待完善资质', icon: '○', rate: null, weight: 0 };
  if (stats.qualified) {
    level = LEVELS[0];
    for (const candidate of LEVELS.slice(1)) {
      if (stats.completed >= candidate.min && positiveRate !== null && positiveRate >= candidate.positive
        && (candidate.dispute === null || disputeRate < candidate.dispute)) level = candidate;
    }
  }
  return { ...level, completed: stats.completed, reviews: stats.reviews, positiveRate, disputeRate, accepted: stats.accepted, disputed: stats.disputed };
}
// 晋级条件只由服务端计算；前端不能提交等级或修改统计值。
function advancement(current) {
  const index = LEVELS.findIndex(level => level.key === current.key);
  const next = LEVELS[index + 1] || null;
  if (!next) return { next: null, requirements: [], orderProgressPct: 100 };
  const qualified = current.key !== 'UNQUALIFIED';
  const orderGap = Math.max(0, next.min - current.completed);
  const ratingMet = next.positive === 0 || (current.positiveRate !== null && current.positiveRate >= next.positive);
  const disputeMet = next.dispute === null || current.disputeRate < next.dispute;
  const requirements = [
    { key: 'qualification', label: '身份认证与基础资质', met: qualified, currentText: qualified ? '已满足' : '未满足', targetText: '实名认证通过并提交基础资质材料' },
    { key: 'orders', label: '累计完成订单', met: orderGap === 0, currentText: current.completed + ' 单', targetText: '至少 ' + next.min + ' 单', hint: orderGap ? '还差 ' + orderGap + ' 单' : '已达标' },
  ];
  if (next.positive > 0) requirements.push({ key: 'rating', label: '好评率', met: ratingMet,
    currentText: current.positiveRate === null ? '暂无评价' : current.positiveRate.toFixed(2) + '%',
    targetText: '≥ ' + next.positive + '%', hint: ratingMet ? '已达标' : '需提升客户有效好评比例；无评价不能晋级' });
  if (next.dispute !== null) requirements.push({ key: 'dispute', label: '纠纷率', met: disputeMet,
    currentText: current.disputeRate.toFixed(2) + '%', targetText: '< ' + next.dispute + '%',
    hint: disputeMet ? '已达标' : '尚未达到严格小于门槛的要求' });
  return { next, requirements, orderProgressPct: next.min ? Math.min(100, Math.floor(current.completed / next.min * 100)) : (qualified ? 100 : 0) };
}
async function getLevel(id) {
  const row = await queryOne(`SELECT
    (SELECT COUNT(*) FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE q.engineerId=? AND o.completedAt IS NOT NULL) AS completed,
    (SELECT COUNT(*) FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE q.engineerId=? AND o.paidAt IS NOT NULL) AS accepted,
    (SELECT COUNT(DISTINCT d.orderId) FROM disputes d JOIN orders o ON o.id=d.orderId JOIN quotes q ON q.id=o.selectedQuoteId WHERE q.engineerId=? AND o.paidAt IS NOT NULL) AS disputed,
    (SELECT COUNT(*) FROM engineer_reviews WHERE engineerId=?) AS reviews,
    (SELECT COUNT(*) FROM engineer_reviews WHERE engineerId=? AND (qualityScore+attitudeScore+speedScore+COALESCE(professionalScore,(qualityScore+attitudeScore+speedScore)/3)+COALESCE(communicationScore,(qualityScore+attitudeScore+speedScore)/3))/5>=4) AS positive,
    (SELECT COUNT(*) FROM identity_verifications iv WHERE iv.userId=? AND iv.verifyStatus='APPROVED' AND EXISTS(SELECT 1 FROM identity_verification_files f WHERE f.userId=iv.userId AND f.purpose='SUPPORTING')) AS qualified`, Array(6).fill(id));
  const stats = Object.fromEntries(Object.entries(row).map(([k,v]) => [k, Number(v || 0)]));
  const level = calculate(stats);
  await query(`UPDATE engineer_profiles SET levelKey=?, completedOrderCount=?, positiveReviewRate=?, disputeRate=?, levelUpdatedAt=UTC_TIMESTAMP(3) WHERE userId=?`,
    [level.key, level.completed, level.positiveRate, level.disputeRate, id]);
  return { ...level, advancement: advancement(level) };
}
// 业务提交后刷新，不让缓存更新失败回滚已经成功的验收/评价。资料读取会再次计算兜底。
async function refreshLevelSafe(id) {
  if (!id) return;
  try { return await getLevel(id); }
  catch (e) { console.error('[engineer-level/refresh]', id, e.message); }
}
async function refreshForOrder(orderId) {
  if (!orderId) return;
  try {
    const row = await queryOne('SELECT q.engineerId FROM orders o JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=?', [orderId]);
    if (row) await refreshLevelSafe(row.engineerId);
  } catch (e) { console.error('[engineer-level/order]', orderId, e.message); }
}
module.exports = { LEVELS, calculate, getLevel, advancement, refreshLevelSafe, refreshForOrder };
