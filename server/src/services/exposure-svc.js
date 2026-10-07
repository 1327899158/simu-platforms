'use strict';
const { queryOne, tx } = require('../db');
const { err } = require('../lib/http');
const { newId, v } = require('../lib/util');
const { config } = require('../config');
const { wxpayRequest, cloudPayResult } = require('./pay-svc');
const PRICE_FEN = 1900, PEOPLE_PER_UNIT = 100;
function quantity(units = 1) { return v.int(units, '曝光份数', { min: 1, max: 100 }); }
async function create(conn, orderId, customerId, units) {
  units = quantity(units);
  await conn.execute(`INSERT INTO order_exposures(orderId,customerId,targetPeople,amountFen,outTradeNo,createdAt)
    VALUES(?,?,?,?,?,UTC_TIMESTAMP(3))`, [orderId, customerId, units * PEOPLE_PER_UNIT, units * PRICE_FEN, newId()]);
}
function view(row) {
  if (!row) return null;
  const deliveredPeople = Number(row.deliveredPeople), targetPeople = Number(row.targetPeople);
  const state = row.paymentStatus !== 'SUCCESS' ? 'UNPAID' : deliveredPeople >= targetPeople ? 'COMPLETED' : row.orderStatus === 'QUOTING' && !row.deletedAt ? 'ACTIVE' : 'PAUSED';
  return { targetPeople, deliveredPeople, amountFen: Number(row.amountFen), state,
    progress: Math.min(100, Math.floor(deliveredPeople * 100 / targetPeople)),
    paymentMode: row.paymentMode, paidAt: row.paidAt || null };
}
async function read(orderId, customerId) {
  const order = await queryOne('SELECT id FROM orders WHERE id=? AND customerId=? AND deletedAt IS NULL', [orderId, customerId]);
  if (!order) throw err.notFound('订单不存在');
  const row = await queryOne(`SELECT e.*,o.status AS orderStatus,o.deletedAt FROM order_exposures e
    JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci=e.orderId WHERE e.orderId=?`, [orderId]);
  if (row?.paymentStartedAt && row.paymentStatus === 'PENDING' && config.paymentMode === 'wechat') {
    await reconcile(row.outTradeNo);
    return view(await queryOne(`SELECT e.*,o.status AS orderStatus,o.deletedAt FROM order_exposures e
      JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci=e.orderId WHERE e.orderId=?`, [orderId]));
  }
  return view(row);
}
async function pay(user, orderId, units, context) {
  const mock = config.paymentMode === 'mock';
  const service = config.wxpayCallbackService || context.service;
  if (!mock && (!config.wxpayMchid || !config.wxAppid || !config.cloudbaseEnv || !service)) throw err.conflict('请先配置微信支付商户号、AppID和回调服务');
  const row = await tx(async conn => {
    const [[order]] = await conn.execute('SELECT * FROM orders WHERE id=? AND customerId=? AND deletedAt IS NULL FOR UPDATE', [orderId, user.id]);
    if (!order || order.status !== 'QUOTING') throw err.conflict('仅待报价的公开需求可购买曝光');
    const [[direct]] = await conn.execute('SELECT orderId FROM direct_demands WHERE orderId=?', [orderId]);
    if (direct) throw err.bad('定向需求不支持公开曝光');
    let [[e]] = await conn.execute('SELECT * FROM order_exposures WHERE orderId=? FOR UPDATE', [orderId]);
    if (!e) { await create(conn, orderId, user.id, units); [[e]] = await conn.execute('SELECT * FROM order_exposures WHERE orderId=?', [orderId]); }
    if (e.paymentStatus === 'SUCCESS') return e;
    // 同一支付单的金额在首次支付后固定，取消支付可使用原单重试。
    if (!e.paymentStartedAt) {
      const n = quantity(units);
      await conn.execute('UPDATE order_exposures SET targetPeople=?,amountFen=?,paymentStartedAt=UTC_TIMESTAMP(3),paymentMode=? WHERE orderId=?', [n * 100, n * PRICE_FEN, mock ? 'mock' : 'wechat', orderId]);
      e.targetPeople = n * 100; e.amountFen = n * PRICE_FEN;
    }
    return e;
  });
  if (row.paymentStatus === 'SUCCESS') return { alreadyPaid: true };
  if (mock) return { mode: 'mock', amountFen: Number(row.amountFen) };
  const result = cloudPayResult(await wxpayRequest('POST', '/unifiedorder', {
    body: '需求曝光·' + row.targetPeople + '人', out_trade_no: row.outTradeNo, sub_mch_id: config.wxpayMchid,
    total_fee: Number(row.amountFen), openid: user.openid, spbill_create_ip: context.clientIp || '127.0.0.1',
    env_id: config.cloudbaseEnv, callback_type: 2, container: { service, path: '/api/exposure-pay/notify' },
  }), '曝光支付下单');
  const p = result.payment;
  if (!p?.timeStamp || !p.nonceStr || !p.package || !p.paySign) throw err.bad('曝光支付调起参数不完整');
  return { mode: 'wechat', amountFen: Number(row.amountFen), timeStamp: String(p.timeStamp), nonceStr: p.nonceStr, package: p.package, signType: p.signType || 'MD5', paySign: p.paySign };
}
async function applySuccess(outTradeNo, transactionId, mock = false) {
  return tx(async conn => {
    // 与选标/关闭保持相同锁顺序，避免已支付通知与履约状态变化死锁。
    const [[lookup]] = await conn.execute('SELECT orderId FROM order_exposures WHERE outTradeNo=?', [outTradeNo]);
    if (!lookup) throw err.notFound('曝光支付单不存在');
    await conn.execute('SELECT id FROM orders WHERE id=? FOR UPDATE', [lookup.orderId]);
    const [[e]] = await conn.execute('SELECT * FROM order_exposures WHERE outTradeNo=? FOR UPDATE', [outTradeNo]);
    if (e.paymentStatus === 'SUCCESS') {
      if (e.transactionId !== transactionId) throw err.conflict('曝光支付流水不匹配');
      return;
    }
    if (mock && config.paymentMode !== 'mock') throw err.forbidden('模拟曝光支付未开启');
    await conn.execute("UPDATE order_exposures SET paymentStatus='SUCCESS',transactionId=?,paymentMode=?,paidAt=UTC_TIMESTAMP(3) WHERE orderId=?", [transactionId, mock ? 'mock' : 'wechat', e.orderId]);
    await conn.execute("UPDATE orders SET promotion='EXPOSURE' WHERE id=?", [e.orderId]);
  });
}
async function reconcile(outTradeNo) {
  if (config.paymentMode !== 'wechat') throw err.notFound('真实曝光支付未开启');
  v.str(outTradeNo, '支付单号', { min: 1, max: 32 });
  const e = await queryOne('SELECT * FROM order_exposures WHERE outTradeNo=?', [outTradeNo]);
  if (!e) throw err.notFound('曝光支付单不存在');
  const b = cloudPayResult(await wxpayRequest('POST', '/queryorder', { out_trade_no: outTradeNo, sub_mch_id: config.wxpayMchid }), '曝光查单');
  if ((b.trade_state || b.tradeState) !== 'SUCCESS') return { paid: false };
  if ((b.out_trade_no || b.outTradeNo) !== outTradeNo || (b.sub_appid || b.subAppid || b.appid || b.appId) !== config.wxAppid
    || String(b.sub_mch_id || b.subMchId || b.mch_id || b.mchId || '') !== config.wxpayMchid
    || Number(b.total_fee ?? b.totalFee) !== Number(e.amountFen) || (b.fee_type || b.feeType || 'CNY') !== 'CNY') throw err.conflict('曝光支付归属或金额不匹配');
  const tid = b.transaction_id || b.transactionId;
  if (!tid || typeof tid !== 'string') throw err.conflict('曝光支付缺少流水号');
  await applySuccess(outTradeNo, tid);
  return { paid: true };
}
async function impressions(user, entries) {
  const results = [];
  // 固定锁顺序，批量上报最多5张卡片。
  for (const entry of entries.slice().sort((a, b) => a.orderId.localeCompare(b.orderId))) {
    results.push(await tx(async conn => {
      const [[o]] = await conn.execute('SELECT status,deletedAt,customerId FROM orders WHERE id=? FOR UPDATE', [entry.orderId]);
      if (!o || o.deletedAt || o.status !== 'QUOTING' || o.customerId === user.id) return { orderId: entry.orderId, counted: false };
      const [[e]] = await conn.execute('SELECT * FROM order_exposures WHERE orderId=? FOR UPDATE', [entry.orderId]);
      if (!e || e.paymentStatus !== 'SUCCESS' || e.deliveredPeople >= e.targetPeople) return { orderId: entry.orderId, counted: false };
      const [r] = await conn.execute(`UPDATE exposure_deliveries SET seenAt=UTC_TIMESTAMP(3)
        WHERE orderId=? AND engineerId=? AND token=? AND seenAt IS NULL AND expiresAt>UTC_TIMESTAMP(3)`, [entry.orderId, user.id, entry.token]);
      if (r.affectedRows) await conn.execute('UPDATE order_exposures SET deliveredPeople=deliveredPeople+1 WHERE orderId=?', [entry.orderId]);
      return { orderId: entry.orderId, counted: r.affectedRows === 1 };
    }));
  }
  return results;
}
module.exports = { create, quantity, view, read, pay, reconcile, applySuccess, impressions, PRICE_FEN };
