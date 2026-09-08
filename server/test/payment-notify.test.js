'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let config = { paymentMode: 'wechat' }, verification, called;
mock('../src/config', { config });
mock('../src/db', {});
mock('../src/lib/auth-mw', {});
mock('../src/services/pay-svc', { reconcilePayment: async no => { called = no; return verification(); } });
const { createRouter } = require('../src/lib/http');
const router = createRouter(); require('../src/routes/payments').register(router);
async function notify(body) {
  let status, result;
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  await router.match('POST', '/api/pay/notify').handler(req, { writeHead(code) { status = code; }, end(raw) { result = JSON.parse(raw); } });
  return { status, result };
}
test('伪造成功回调不能覆盖查单结果；查询失败返回失败让平台重试', async () => {
  verification = () => ({ reason: 'not-paid' });
  assert.equal((await notify({ trade_state: 'SUCCESS', out_trade_no: 'trade' })).status, 500);
  assert.equal(called, 'trade');
  verification = () => { throw new Error('查询超时'); };
  assert.equal((await notify({ result_code: 'SUCCESS', out_trade_no: 'trade' })).status, 500);
  verification = () => ({ applied: true });
  assert.equal((await notify({ resultCode: 'SUCCESS', outTradeNo: 'trade' })).status, 200);
});
test('模拟支付模式关闭公开成功回调', async () => {
  config.paymentMode = 'mock';
  await assert.rejects(notify({ trade_state: 'SUCCESS', out_trade_no: 'trade' }), e => e.status === 404);
});
