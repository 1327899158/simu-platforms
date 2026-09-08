'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
const config = { env: 'production', paymentMode: 'wechat', wxpayMchid: 'merchant', wxAppid: 'app', cloudbaseEnv: 'env', wxpayCallbackService: 'simu-api', payAmountOverrideFen: 1, payTimeoutSec: 1800 };
let payment, order, sqlLog, requests, response, expired, concurrentPayment;
mock('../src/config', { config });
mock('../src/services/chat-svc', {
  ensureConversation: async () => ({ id: 'conv' }), systemMessage: async () => ({ msgId: 'msg' }),
  publishConversationDoc() {}, publishSystemMessage() {},
});
const conn = { execute: async (sql, args) => {
  sqlLog.push(sql);
  if (sql.startsWith('SELECT orderId FROM payments')) return [[payment && { orderId: payment.orderId }].filter(Boolean)];
  if (sql.startsWith('SELECT') && sql.includes('FROM orders')) { assert.match(sql, /FOR UPDATE/); return [[{ ...order }]]; }
  if (sql.startsWith('SELECT outTradeNo,status FROM payments')) return [[...(payment ? [{ ...payment }] : []), ...(concurrentPayment ? [concurrentPayment] : [])]];
  if (sql.startsWith('SELECT * FROM payments')) return [[payment && { ...payment }].filter(Boolean)];
  if (sql.startsWith('INSERT INTO payments')) {
    payment = { id: args[0], orderId: args[1], outTradeNo: args[2], amountFen: args[3], status: 'PENDING' };
  } else if (sql.includes("UPDATE payments SET status='SUCCESS'")) {
    Object.assign(payment, { status: 'SUCCESS', transactionId: args[0] });
  } else if (sql.includes("UPDATE orders SET status='IN_PROGRESS'")) {
    const applied = order.status === 'AWAITING_PAYMENT' && args[3] === 1;
    if (applied) order.status = 'IN_PROGRESS';
    return [{ affectedRows: applied ? 1 : 0 }];
  } else if (sql.includes("UPDATE orders SET status='QUOTING'")) {
    assert.match(sql, /selectedQuoteId=\? AND selectedAt < \?/);
    order.status = 'QUOTING';
  } else if (sql.includes("UPDATE payments SET status='FAILED'")) { if (payment) payment.status = 'FAILED'; }
  else if (!sql.startsWith('UPDATE payments SET raw=') && !sql.startsWith('UPDATE quotes')) throw new Error('Unexpected SQL: ' + sql);
  return [{ affectedRows: 1 }];
} };
mock('../src/db', {
  tx: async work => work(conn), queryOne: async () => payment,
  query: async sql => sql.includes('FROM orders') ? expired : (payment ? [{ ...payment }] : []),
});
http.request = (opts, callback) => {
  const req = new EventEmitter(); let data = '';
  req.setTimeout = () => req;
  req.write = chunk => { data += chunk; };
  req.end = () => {
    requests.push({ ...opts, data: data ? JSON.parse(data) : null });
    const res = new EventEmitter(); res.statusCode = 200;
    callback(res); res.emit('data', JSON.stringify(response(opts))); res.emit('end');
  };
  return req;
};
const svc = require('../src/services/pay-svc');
beforeEach(() => {
  config.paymentMode = 'wechat';
  payment = { id: 'p', orderId: 'o', outTradeNo: 'trade', amountFen: 380000, status: 'PENDING' };
  order = { id: 'o', status: 'AWAITING_PAYMENT', selectedQuoteId: 'q', finalAmountFen: 380000 };
  sqlLog = []; requests = []; expired = []; concurrentPayment = null;
  response = () => ({ return_code: 'SUCCESS', result_code: 'SUCCESS', out_trade_no: 'trade', trade_state: 'SUCCESS', sub_appid: 'app', sub_mch_id: 'merchant', total_fee: 380000, transaction_id: 'wx-transaction' });
});
const event = amount => ({ trade_state: 'SUCCESS', out_trade_no: 'trade', amount: { total: amount, currency: 'CNY' } });
test('生产不使用一分钱覆盖价；新支付单号不超过 32 位；状态改变拒绝创建', async () => {
  payment = null;
  const p = await svc.createPayment(order);
  assert.equal(p.amountFen, 380000); assert.ok(p.outTradeNo.length <= 32);
  order.status = 'QUOTING';
  await assert.rejects(svc.createPayment(order), e => e.status === 409);
});
test('支付校验金额、币种、流水号，重复成功不重复推进订单', async () => {
  await assert.rejects(svc.applyPaymentSuccess('trade', 'wx', event(1)), e => e.status === 409);
  await assert.rejects(svc.applyPaymentSuccess('trade', '', event(380000)), e => e.status === 400);
  await assert.rejects(svc.applyPaymentSuccess('trade', 'wx', { ...event(380000), amount: { total: 380000, currency: 'USD' } }), e => e.status === 409);
  assert.equal(payment.status, 'PENDING');
  assert.equal((await svc.applyPaymentSuccess('trade', 'wx', event(380000))).applied, true);
  assert.equal((await svc.applyPaymentSuccess('trade', 'wx', event(380000))).reason, 'already-success');
  await assert.rejects(svc.applyPaymentSuccess('trade', 'other', event(380000)), e => e.status === 409);
});
test('过期支付单迟到成功只记录收款异常，不推进新一轮选标', async () => {
  payment.status = 'FAILED';
  assert.equal((await svc.applyPaymentSuccess('trade', 'wx', event(380000))).reason, 'order-not-awaiting');
  assert.equal(order.status, 'AWAITING_PAYMENT'); assert.equal(payment.status, 'SUCCESS');
});
test('查单使用云托管 queryorder，并验证商户和 AppID', async () => {
  await svc.reconcilePayment('trade');
  assert.equal(requests[0].path, '/_/pay/queryorder');
  assert.equal(requests[0].data.sub_mch_id, 'merchant');
  response = () => ({ return_code: 'SUCCESS', result_code: 'SUCCESS', out_trade_no: 'trade', sub_mch_id: 'other' });
  await assert.rejects(svc.reconcilePayment('trade'), e => e.status === 409);
});
test('下单使用云托管 unifiedorder，并展开 payment 调起参数', async () => {
  response = () => ({ return_code: 'SUCCESS', result_code: 'SUCCESS', payment: { timeStamp: '123', nonceStr: 'nonce', package: 'prepay_id=p', paySign: 'signature', signType: 'MD5' } });
  const result = await svc.createJsapiOrder({ ...order, projectName: '结构分析' }, 'openid');
  assert.equal(requests[0].path, '/_/pay/unifiedorder');
  assert.deepEqual(requests[0].data.container, { service: 'simu-api', path: '/api/pay/notify' });
  assert.equal(result.package, 'prepay_id=p'); assert.equal(result.amountFen, 380000);
});
test('超时先查单和关单；关单失败保留原订单', async () => {
  expired = [{ id: 'o', selectedQuoteId: 'q' }];
  response = opts => opts.path.endsWith('/queryorder')
    ? { return_code: 'SUCCESS', result_code: 'SUCCESS', out_trade_no: 'trade', sub_appid: 'app', sub_mch_id: 'merchant', trade_state: 'NOTPAY' }
    : { return_code: 'FAIL' };
  assert.equal(await svc.sweepExpiredAwaitingPayment(), 0);
  assert.equal(order.status, 'AWAITING_PAYMENT');
  assert.equal(requests[1].path, '/_/pay/closeorder');
});
test('关单期间出现新待支付单，不回退订单；全部已关闭才回退', async () => {
  expired = [{ id: 'o', selectedQuoteId: 'q' }];
  response = () => ({ return_code: 'SUCCESS', result_code: 'SUCCESS', out_trade_no: 'trade', sub_appid: 'app', sub_mch_id: 'merchant', trade_state: 'CLOSED' });
  concurrentPayment = { outTradeNo: 'new-trade', status: 'PENDING' };
  assert.equal(await svc.sweepExpiredAwaitingPayment(), 0);
  assert.equal(order.status, 'AWAITING_PAYMENT');
  concurrentPayment = null;
  assert.equal(await svc.sweepExpiredAwaitingPayment(), 1);
  assert.equal(order.status, 'QUOTING'); assert.equal(payment.status, 'FAILED');
});
