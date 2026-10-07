'use strict';
const { query, queryOne } = require('../db');
const { requireCustomer, requireEngineer } = require('../lib/auth-mw');
const { ok, readJson, sendJson, err } = require('../lib/http');
const { v, newId } = require('../lib/util');
const { config } = require('../config');
const exposure = require('../services/exposure-svc');
function register(router) {
  router.get('/api/orders/:id/exposure', async (req, res, p) => ok(res, await exposure.read(p.id, (await requireCustomer(req)).id)));
  router.post('/api/orders/:id/exposure/pay', async (req, res, p) => {
    const u = await requireCustomer(req), b = await readJson(req);
    ok(res, await exposure.pay(u, p.id, exposure.quantity(b.units), { service: req.headers?.['x-wx-service'], clientIp: req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress }));
  });
  router.post('/api/orders/:id/exposure/mock-confirm', async (req, res, p) => {
    if (config.paymentMode !== 'mock') throw err.notFound('模拟曝光支付未开启');
    const u = await requireCustomer(req);
    const e = await queryOne('SELECT * FROM order_exposures WHERE orderId=? AND customerId=?', [p.id, u.id]);
    if (!e || !e.paymentStartedAt) throw err.notFound('请先发起曝光支付');
    await exposure.applySuccess(e.outTradeNo, e.transactionId || 'MOCK_' + e.outTradeNo, true);
    ok(res, { paid: true });
  });
  router.post('/api/exposure-pay/notify', async (req, res) => {
    if (config.paymentMode !== 'wechat') throw err.notFound('真实曝光支付未开启');
    try {
      const b = await readJson(req);
      if (!((await exposure.reconcile(b.out_trade_no || b.outTradeNo)).paid)) throw Error('曝光支付待确认');
      sendJson(res, 200, { errcode: 0, errmsg: 'OK' });
    } catch (e) {
      console.error('[exposure-pay]', e.message);
      sendJson(res, 500, { errcode: -1, errmsg: 'payment verification failed' });
    }
  });
  router.get('/api/home/exposures', async (req, res) => {
    const u = await requireEngineer(req);
    const rows = await query(`SELECT o.* FROM order_exposures e
      JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci=e.orderId
      LEFT JOIN exposure_deliveries d ON d.orderId=e.orderId AND d.engineerId=?
      WHERE e.paymentStatus='SUCCESS' AND e.deliveredPeople<e.targetPeople AND o.status='QUOTING'
      AND o.deletedAt IS NULL AND o.customerId<>? AND (d.orderId IS NULL OR d.seenAt IS NULL)
      AND NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE dd.orderId COLLATE utf8mb4_unicode_ci=e.orderId)
      ORDER BY CRC32(CONCAT(e.orderId,?)),e.orderId LIMIT 5`, [u.id, u.id, u.id]);
    const items = [];
    for (const o of rows) {
      await query(`INSERT INTO exposure_deliveries(orderId,engineerId,token,expiresAt) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE))
        ON DUPLICATE KEY UPDATE expiresAt=IF(seenAt IS NULL,VALUES(expiresAt),expiresAt)`, [o.id, u.id, newId()]);
      const d = await queryOne('SELECT token FROM exposure_deliveries WHERE orderId=? AND engineerId=?', [o.id, u.id]);
      items.push(require('./orders').orderView(o, { impressionToken: d.token }));
    }
    ok(res, { items });
  });
  router.post('/api/home/exposures/impressions', async (req, res) => {
    const u = await requireEngineer(req), b = await readJson(req);
    const entries = v.arr(b.items, '曝光记录', { minLen: 1, maxLen: 5 }).map(x => ({ orderId: v.str(x?.orderId, '订单ID', { min: 1, max: 32 }), token: v.str(x?.token, '展示凭证', { min: 1, max: 32 }) }));
    ok(res, await exposure.impressions(u, entries));
  });
}
module.exports = { register };
