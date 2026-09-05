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
  return level;
}
module.exports = { LEVELS, calculate, getLevel };
