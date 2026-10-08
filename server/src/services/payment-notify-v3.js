'use strict';
const { readBody, sendJson, err } = require('../lib/http');
const { config } = require('../config');
const { queryOne } = require('../db');
const wxpay = require('./wechat-pay-v3');

function handler(kind) {
  return async (req, res) => {
    if (config.paymentMode !== 'wechat') throw err.notFound('真实支付未开启');
    try {
      // 必须验签原始字节，禁止先 JSON.parse 后重新序列化验签。
      const event = wxpay.decryptNotification(req.headers, await readBody(req, 128 * 1024));
      const b = event.data;
      if (kind === 'refund') {
        if (event.originalType !== 'refund' || !['REFUND.SUCCESS', 'REFUND.ABNORMAL', 'REFUND.CLOSED'].includes(event.eventType)) throw err.bad('退款通知类型无效');
        await require('./refund-svc').reconcile(b.out_refund_no);
      } else {
        if (event.originalType !== 'transaction' || event.eventType !== 'TRANSACTION.SUCCESS'
          || b.appid !== config.wxAppid || b.trade_state !== 'SUCCESS') throw err.bad('支付通知类型或 AppID 无效');
        const table = kind === 'exposure' ? 'order_exposures' : 'payments';
        const record = await queryOne(`SELECT provider FROM ${table} WHERE outTradeNo=?`, [b.out_trade_no]);
        if (record?.provider !== 'v3') throw err.conflict('支付通知通道不匹配');
        if (kind === 'exposure') {
          if (!(await require('./exposure-svc').reconcile(b.out_trade_no)).paid) throw Error('曝光支付待确认');
        } else {
          const result = await require('./pay-svc').reconcilePayment(b.out_trade_no);
          if (result.reason === 'not-paid') throw Error('支付待确认');
        }
      }
      res.writeHead(204); res.end();
    } catch (e) {
      console.error('[wechat-pay-v3/notify]', kind, e.message);
      sendJson(res, e.status === 403 ? 401 : e.status === 400 ? 400 : 500,
        { code: 'FAIL', message: 'notification verification failed' });
    }
  };
}
module.exports = { handler };
