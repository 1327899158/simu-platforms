'use strict';
/**
 * 支付服务（云开发版）。
 * 下单：调用云托管「开放接口服务」代签名的内部地址 http://api.weixin.qq.com/_/pay/...
 * 回调仅触发服务端查单，不把回调请求体当成可信的支付凭证。
 * 幂等：outTradeNo 唯一 + 事务内状态判断。
 */
const http = require('node:http');
const { err } = require('../lib/http');
const { newId, nowIso } = require('../lib/util');
const { config } = require('../config');
const { query, queryOne, tx } = require('../db');
const {
  ensureConversation,
  systemMessage,
  publishConversationDoc,
  publishSystemMessage,
} = require('./chat-svc');

/**
 * 向微信云托管代签名网关发 HTTP 请求（内部地址，无需签名）。
 * 使用云托管统一下单/查单/关单接口，不混用微信支付 V3 URL。
 * 云托管内部自动处理：
 * 商户参数显式传 sub_mch_id，云平台负责底层支付通信。
 */
function wxpayRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'api.weixin.qq.com',
      path: '/_/pay' + path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('微信支付接口请求超时')));
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** 创建/复用支付单 */
async function createPayment(order) {
  return tx(async conn => {
    const [[current]] = await conn.execute('SELECT * FROM orders WHERE id=? AND deletedAt IS NULL FOR UPDATE', [order.id]);
    if (!current || current.status !== 'AWAITING_PAYMENT' || current.selectedQuoteId !== order.selectedQuoteId) throw err.conflict('订单状态已变化，请刷新后支付');
    const amountFen = Number(config.env !== 'production' && config.payAmountOverrideFen || current.finalAmountFen);
    if (!Number.isSafeInteger(amountFen) || amountFen <= 0) throw err.conflict('订单金额异常');
    const [[existing]] = await conn.execute(
      "SELECT * FROM payments WHERE orderId=? AND status='PENDING' AND amountFen=? ORDER BY createdAt DESC LIMIT 1 FOR UPDATE",
      [current.id, amountFen]);
    if (existing) return existing;
    const id = newId(), outTradeNo = newId();
    await conn.execute('INSERT INTO payments(id,orderId,outTradeNo,amountFen,createdAt) VALUES(?,?,?,?,?)',
      [id, current.id, outTradeNo, amountFen, nowIso()]);
    return { id, orderId: current.id, outTradeNo, amountFen, status: 'PENDING' };
  });
}

// 回调内容只作为查单线索；支付事实从服务端微信支付查询结果取得。
async function reconcilePayment(outTradeNo) {
  if (config.paymentMode !== 'wechat') throw err.notFound('真实支付未开启');
  if (typeof outTradeNo !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(outTradeNo)) throw err.bad('支付单号不合法');
  if (!config.wxpayMchid || !config.wxAppid) throw err.conflict('请配置微信支付商户号和小程序 AppID');
  const payment = await queryOne('SELECT * FROM payments WHERE outTradeNo=?', [outTradeNo]);
  if (!payment) throw err.notFound('支付单不存在');
  const response = await wxpayRequest('POST', '/queryorder', { out_trade_no: outTradeNo, sub_mch_id: config.wxpayMchid });
  const body = cloudPayResult(response, '查单');
  const event = {
    trade_state: body.trade_state || body.tradeState,
    out_trade_no: body.out_trade_no || body.outTradeNo,
    transaction_id: body.transaction_id || body.transactionId,
    appid: body.sub_appid || body.subAppid || body.appid || body.appId,
    mchid: String(body.sub_mch_id || body.subMchId || body.mch_id || body.mchId || ''),
    amount: { total: body.total_fee ?? body.totalFee, currency: body.fee_type || body.feeType || 'CNY' },
  };
  if (event.out_trade_no !== outTradeNo || event.appid !== config.wxAppid || event.mchid !== config.wxpayMchid) throw err.conflict('支付订单归属不匹配');
  if (event.trade_state !== 'SUCCESS') return { applied: false, reason: 'not-paid', tradeState: event.trade_state };
  return applyPaymentSuccess(outTradeNo, event.transaction_id, event);
}

/**
 * 调用云托管开放接口发起 JSAPI 下单。
 * 返回前端调起 wx.requestPayment 所需的五参数（由 sidecar 代签）。
 */
function cloudPayResult(response, action) {
  const b = response.body;
  if (response.status !== 200 || !b || typeof b !== 'object'
    || (b.return_code || b.returnCode) !== 'SUCCESS'
    || (b.result_code || b.resultCode) !== 'SUCCESS') {
    throw err.bad('微信支付' + action + '失败：' + String(b?.err_code_des || b?.errCodeDes || b?.return_msg || b?.returnMsg || b?.errmsg || response.status).slice(0, 180));
  }
  return b;
}

async function createJsapiOrder(order, openid, context = {}) {
  if (!config.wxpayMchid || !config.wxAppid) throw err.conflict('请配置微信支付商户号和小程序 AppID');
  const service = config.wxpayCallbackService || context.service;
  if (!service || !config.cloudbaseEnv) throw err.conflict('请配置微信支付回调服务名和云环境');
  const payment = await createPayment(order);
  const response = await wxpayRequest('POST', '/unifiedorder', {
    body: '仿真服务·' + String(order.projectName || '').slice(0, 30),
    out_trade_no: payment.outTradeNo, sub_mch_id: config.wxpayMchid,
    total_fee: Number(payment.amountFen), openid,
    spbill_create_ip: context.clientIp || '127.0.0.1',
    env_id: config.cloudbaseEnv, callback_type: 2,
    container: { service, path: '/api/pay/notify' },
  });
  const result = cloudPayResult(response, '下单');
  const params = result.payment;
  if (!params || !params.timeStamp || !params.nonceStr || !params.package || !params.paySign) {
    throw err.bad('微信支付下单未返回完整调起参数');
  }
  return { mode: 'wechat', outTradeNo: payment.outTradeNo, amountFen: Number(payment.amountFen),
    timeStamp: String(params.timeStamp), nonceStr: params.nonceStr, package: params.package,
    signType: params.signType || 'MD5', paySign: params.paySign };
}

/**
 * 幂等落账（回调、查单兜底共用）。
 *
 * 事务只做 MySQL 主流程：
 *   1) 支付单置 SUCCESS
 *   2) 订单 AWAITING_PAYMENT → IN_PROGRESS
 *   3) 建会话（MySQL 部分）
 *   4) 写系统消息（MySQL 部分）
 *
 * 云 DB 推送（conversations 文档 + 系统消息文档）在事务提交**之后**做，
 * 且都是 fire-and-forget + 超时保护——避免云托管 sidecar 抖动时把 InnoDB
 * 事务拖到锁等待超时（历史上出现过 128s、50s 的 Lock wait timeout）。
 */
async function applyPaymentSuccess(outTradeNo, transactionId, rawEvent = null) {
  const result = await tx(async (conn) => {
    const [[lookup]] = await conn.execute('SELECT orderId FROM payments WHERE outTradeNo=?', [outTradeNo]);
    if (!lookup) throw err.notFound('支付单不存在');
    await conn.execute('SELECT id FROM orders WHERE id=? FOR UPDATE', [lookup.orderId]);
    const [rows] = await conn.execute('SELECT * FROM payments WHERE outTradeNo=? FOR UPDATE', [outTradeNo]);
    const p = rows[0];
    if (!p) throw err.notFound('支付单不存在');
    const mock = config.paymentMode === 'mock' && rawEvent?.mock === true;
    if (!transactionId || typeof transactionId !== 'string') throw err.bad('缺少支付流水号');
    if (!mock && (rawEvent?.trade_state !== 'SUCCESS' || rawEvent?.out_trade_no !== outTradeNo
      || rawEvent?.amount?.currency !== 'CNY' || !Number.isSafeInteger(Number(rawEvent?.amount?.total))
      || Number(rawEvent.amount.total) !== Number(p.amountFen))) throw err.conflict('支付金额或币种不匹配');
    if (p.status === 'SUCCESS') {
      if (p.transactionId !== transactionId) throw err.conflict('支付流水不匹配');
      return { applied: false, reason: 'already-success' };
    }
    const canAdvance = p.status === 'PENDING';

    await conn.execute(
      `UPDATE payments SET status='SUCCESS', transactionId=?, paidAt=?, raw=? WHERE id=?`,
      [transactionId, nowIso(), rawEvent ? JSON.stringify(rawEvent) : null, p.id]
    );
    const [r] = await conn.execute(
      `UPDATE orders SET status='IN_PROGRESS', paidAt=?, updatedAt=?
       WHERE id=? AND status='AWAITING_PAYMENT' AND ?=1`,
      [nowIso(), nowIso(), p.orderId, canAdvance ? 1 : 0]
    );
    if (r.affectedRows === 0) {
      await conn.execute(`UPDATE payments SET raw=? WHERE id=?`,
        [JSON.stringify({ warn: 'ORDER_NOT_AWAITING_PAYMENT', event: rawEvent }), p.id]);
      return { applied: false, reason: 'order-not-awaiting' };
    }
    // 事务内只写 MySQL；conv._isNew 标记新建的会话，事务提交后由外层推送云 DB。
    const conv = await ensureConversation(p.orderId, conn);
    const sysContent = '订单已支付，工程师可以开始工作了。请双方在此沟通项目细节。';
    const sys = await systemMessage(conv.id, sysContent, conn);
    return {
      applied: true,
      conv,
      sysMsg: { convId: conv.id, content: sysContent, msgId: sys.msgId },
    };
  });

  // ---- 事务提交后：云 DB 推送（fire-and-forget，失败仅日志） ----
  if (result.applied) {
    if (result.conv && result.conv._isNew) {
      publishConversationDoc({
        id: result.conv.id,
        orderId: result.conv.orderId,
        customerId: result.conv.customerId,
        engineerId: result.conv.engineerId,
      });
    }
    if (result.sysMsg) {
      publishSystemMessage(result.sysMsg.convId, result.sysMsg.content, result.sysMsg.msgId);
    }
  }
  return { applied: result.applied, reason: result.reason };
}

/**
 * 超时未支付回退（供云函数定时触发器调用）。
 */
async function sweepExpiredAwaitingPayment() {
  const deadline = new Date(Date.now() - config.payTimeoutSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await query(
    `SELECT id, selectedQuoteId FROM orders
     WHERE status = 'AWAITING_PAYMENT' AND selectedAt < ?`, [deadline]
  );
  let reverted = 0;
  for (const o of rows) {
    const closedTrades = new Set();
    try {
      if (config.paymentMode === 'wechat') {
        const payments = await query("SELECT outTradeNo,status FROM payments WHERE orderId=? AND status IN ('PENDING','SUCCESS')", [o.id]);
        let paid = false;
        for (const payment of payments) {
          if (payment.status === 'SUCCESS') { paid = true; break; }
          const result = await reconcilePayment(payment.outTradeNo);
          if (result.reason !== 'not-paid') { paid = true; break; }
          if (result.tradeState !== 'CLOSED') {
            const closed = await wxpayRequest('POST', '/closeorder', { out_trade_no: payment.outTradeNo, sub_mch_id: config.wxpayMchid });
            cloudPayResult(closed, '关单');
          }
          closedTrades.add(payment.outTradeNo);
        }
        if (paid) continue;
      }
      const changed = await tx(async (conn) => {
        await conn.execute('SELECT id FROM orders WHERE id=? FOR UPDATE', [o.id]);
        if (config.paymentMode === 'wechat') {
          const [currentPayments] = await conn.execute("SELECT outTradeNo,status FROM payments WHERE orderId=? AND status IN ('PENDING','SUCCESS') FOR UPDATE", [o.id]);
          if (currentPayments.some(p => p.status === 'SUCCESS' || !closedTrades.has(p.outTradeNo))) return false;
        }
        const [r] = await conn.execute(
          `UPDATE orders SET status='QUOTING', selectedQuoteId=NULL,
             finalAmountFen=NULL, selectedAt=NULL, updatedAt=?
           WHERE id=? AND status='AWAITING_PAYMENT' AND selectedQuoteId=? AND selectedAt < ?`,
          [nowIso(), o.id, o.selectedQuoteId, deadline]
        );
        if (!r.affectedRows) return false;
        await conn.execute(
          `UPDATE quotes SET status='PENDING', updatedAt=?
           WHERE orderId=? AND status IN ('SELECTED','REJECTED')`,
          [nowIso(), o.id]
        );
        await conn.execute(
          `UPDATE payments SET status='FAILED' WHERE orderId=? AND status='PENDING'`,
          [o.id]
        );
        return true;
      });
      if (!changed) continue;
      reverted++;
      console.log(JSON.stringify({ t: nowIso(), evt: 'pay-timeout-revert', orderId: o.id }));
    } catch (e) {
      console.error(JSON.stringify({ t: nowIso(), evt: 'pay-timeout-retry', orderId: o.id, message: e.message }));
    }
  }
  return reverted;
}

/** 启动内嵌定时清扫（真实支付由此清扫器查单、关单后回退）*/
function startSweeper() {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await sweepExpiredAwaitingPayment(); } catch (e) { console.error('sweep error', e); }
    finally { running = false; }
  }, 30 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { reconcilePayment, createPayment, createJsapiOrder, applyPaymentSuccess, sweepExpiredAwaitingPayment, startSweeper };
