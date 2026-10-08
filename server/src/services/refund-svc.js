'use strict';
const { config } = require('../config');
const { query, queryOne, tx } = require('../db');
const { err } = require('../lib/http');
const { newId } = require('../lib/util');
const wxpay = require('./wechat-pay-v3');

function plan(payment, prior, grossRequested) {
  const gross = Number(payment.grossAmountFen ?? payment.amountFen), coins = Number(payment.coinAmount || 0), cash = Number(payment.amountFen);
  if (![gross, coins, cash].every(Number.isSafeInteger) || gross <= 0 || coins < 0 || cash < 0 || cash + coins !== gross) throw err.conflict('原支付金额不一致');
  const used = prior.filter(r => r.status !== 'CLOSED');
  const remainingGross = gross - used.reduce((n, r) => n + Number(r.grossRefundFen), 0);
  const remainingCoins = coins - used.reduce((n, r) => n + Number(r.coinRefund), 0);
  const remainingCash = cash - used.reduce((n, r) => n + Number(r.cashRefundFen), 0);
  const requested = grossRequested == null ? remainingGross : Number(grossRequested);
  if (!Number.isSafeInteger(requested) || requested <= 0 || requested > remainingGross) throw err.conflict('退款金额超过可退金额');
  const coinRefund = requested === remainingGross ? remainingCoins : Math.min(remainingCoins, Number(BigInt(coins) * BigInt(requested) / BigInt(gross)));
  const cashRefundFen = requested - coinRefund;
  if (coinRefund < 0 || cashRefundFen < 0 || cashRefundFen > remainingCash) throw err.conflict('退款抵扣金额不一致');
  return { grossRefundFen: requested, cashRefundFen, coinRefund, totalCashFen: cash };
}

async function prepare(sourceType, sourceId) {
  if (config.paymentMode !== 'wechat') throw err.conflict('真实退款未开启');
  const table = sourceType === 'AGREED' ? 'refund_requests' : sourceType === 'DISPUTE' ? 'disputes' : null;
  if (!table) throw err.bad('退款来源无效');
  const source = await queryOne(`SELECT * FROM ${table} WHERE id=?`, [sourceId]);
  if (!source) throw err.notFound('退款申请不存在');
  return tx(async c => {
    await c.execute('SELECT id FROM orders WHERE id=? FOR UPDATE', [source.orderId]);
    const [[approved]] = await c.execute(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`, [sourceId]);
    if (!approved || (sourceType === 'AGREED' ? approved.status !== 'AGREED' : approved.status !== 'RESOLVED' || !['PENDING','FAILED','PROCESSED'].includes(approved.refundStatus))) throw err.conflict('退款尚未批准');
    const [[p]] = await c.execute("SELECT * FROM payments WHERE orderId=? AND status='SUCCESS' ORDER BY paidAt DESC LIMIT 1 FOR UPDATE", [source.orderId]);
    if (!p || p.provider !== 'v3') throw err.conflict('该订单需要通过原支付通道处理退款');
    require('./pay-svc').assertPaymentAccount(p);
    const businessKey = sourceType + ':' + sourceId;
    const [prior] = await c.execute('SELECT * FROM payment_refunds WHERE paymentId=? FOR UPDATE', [p.id]);
    const old = prior.find(r => r.businessKey === businessKey);
    if (old) return old;
    if (sourceType === 'DISPUTE' && approved.refundStatus === 'PROCESSED') throw err.conflict('历史退款已登记处理，请核对商户平台，避免重复退款');
    const amounts = plan(p, prior, sourceType === 'AGREED' ? null : approved.refundAmountFen);
    const id = newId(), outRefundNo = 'R_' + newId();
    const row = { id, businessKey, orderId: source.orderId, paymentId: p.id, outTradeNo: p.outTradeNo,
      outRefundNo, sourceType, sourceId, ...amounts, transactionId: p.transactionId, status: 'PENDING' };
    if (!row.transactionId) throw err.conflict('原支付流水不存在');
    await c.execute(`INSERT INTO payment_refunds(id,businessKey,orderId,paymentId,outTradeNo,outRefundNo,sourceType,sourceId,
      grossRefundFen,cashRefundFen,coinRefund,totalCashFen,transactionId) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,businessKey,row.orderId,p.id,p.outTradeNo,outRefundNo,sourceType,sourceId,amounts.grossRefundFen,amounts.cashRefundFen,amounts.coinRefund,amounts.totalCashFen,p.transactionId]);
    return row;
  });
}
async function apply(row, b) {
  if (Number(row.cashRefundFen) > 0 && (b.out_refund_no !== row.outRefundNo || b.out_trade_no !== row.outTradeNo
    || b.transaction_id !== row.transactionId || !b.refund_id || typeof b.refund_id !== 'string'
    || Number(b.amount?.total) !== Number(row.totalCashFen) || Number(b.amount?.refund) !== Number(row.cashRefundFen)
    || b.amount?.currency !== 'CNY' || !['SUCCESS','PROCESSING','ABNORMAL','CLOSED'].includes(b.status))) throw err.conflict('微信退款流水或金额不匹配');
  const result = await tx(async c => {
    await c.execute('SELECT id FROM orders WHERE id=? FOR UPDATE', [row.orderId]);
    const [[current]] = await c.execute('SELECT * FROM payment_refunds WHERE id=? FOR UPDATE', [row.id]);
    if (current.status === 'SUCCESS') return {status:current.status,refundId:current.refundId};
    if (b.status === 'SUCCESS') {
      await require('./coin-svc').refundExact(c, 'ORDER:' + row.outTradeNo, 'REFUND:' + row.id, Number(row.coinRefund));
      if (row.sourceType === 'DISPUTE') await c.execute("UPDATE disputes SET refundStatus='PROCESSED',refundTransactionId=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?", [b.refund_id || 'COINS_' + row.id,row.sourceId]);
    } else if (row.sourceType === 'DISPUTE') {
      await c.execute('UPDATE disputes SET refundStatus=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', [b.status === 'PROCESSING' ? 'PENDING' : 'FAILED', row.sourceId]);
    }
    await c.execute('UPDATE payment_refunds SET status=?,refundId=?,lastError=NULL,updatedAt=UTC_TIMESTAMP(3) WHERE id=?', [b.status,b.refund_id||null,row.id]);
    return {status:b.status,refundId:b.refund_id||null};
  });
  return result;
}
async function process(row) {
  if (row.status === 'SUCCESS' || row.status === 'CLOSED') return { status: row.status, refundId: row.refundId };
  if (Number(row.cashRefundFen) === 0) return apply(row, { status: 'SUCCESS' });
  const payment=await queryOne('SELECT provider,payMchid,payAppid FROM payments WHERE id=?',[row.paymentId]);
  if(payment?.provider!=='v3')throw err.conflict('退款原支付通道不匹配');
  require('./pay-svc').assertPaymentAccount(payment);
  try {
    // 固定 out_refund_no，网络超时和多实例重试都不会生成第二笔退款。
    const response = row.status === 'PENDING'
      ? await wxpay.request('POST','/v3/refund/domestic/refunds', {
        transaction_id: row.transactionId, out_refund_no: row.outRefundNo,
        reason: row.sourceType === 'AGREED' ? '工程师同意退款' : '平台纠纷裁定退款',
        notify_url: wxpay.notifyUrl('/api/pay/v3/refund-notify'),
        amount: { refund: Number(row.cashRefundFen), total: Number(row.totalCashFen), currency: 'CNY' },
      })
      : await wxpay.request('GET','/v3/refund/domestic/refunds/' + encodeURIComponent(row.outRefundNo));
    return await apply(row, wxpay.result(response, '退款'));
  } catch (e) {
    await query('UPDATE payment_refunds SET lastError=?,updatedAt=UTC_TIMESTAMP(3) WHERE id=? AND status<>\'SUCCESS\'', [String(e.message).slice(0,255),row.id]);
    throw e;
  }
}
async function request(sourceType, sourceId) { return process(await prepare(sourceType,sourceId)); }
async function reconcile(outRefundNo) {
  if (typeof outRefundNo !== 'string' || !/^[A-Za-z0-9_-]{6,32}$/.test(outRefundNo)) throw err.bad('退款单号无效');
  const row = await queryOne('SELECT * FROM payment_refunds WHERE outRefundNo=?', [outRefundNo]);
  if (!row) throw err.notFound('退款单不存在');
  // 回调仅触发官方查单，不能直接修改退款状态。
  return process(row.status === 'PENDING' ? { ...row, status: 'PROCESSING' } : row);
}
async function sweep() {
  if (config.paymentMode !== 'wechat') return;
  const sources = await query(`SELECT 'AGREED' sourceType,rr.id FROM refund_requests rr
    JOIN payments p ON p.orderId COLLATE utf8mb4_unicode_ci=rr.orderId COLLATE utf8mb4_unicode_ci AND p.status='SUCCESS' AND p.provider='v3'
    LEFT JOIN payment_refunds r ON r.businessKey=CONCAT('AGREED:',rr.id) COLLATE utf8mb4_unicode_ci
    WHERE rr.status='AGREED' AND r.id IS NULL
    UNION ALL SELECT 'DISPUTE',d.id FROM disputes d
    JOIN payments p ON p.orderId COLLATE utf8mb4_unicode_ci=d.orderId COLLATE utf8mb4_unicode_ci AND p.status='SUCCESS' AND p.provider='v3'
    LEFT JOIN payment_refunds r ON r.businessKey=CONCAT('DISPUTE:',d.id) COLLATE utf8mb4_unicode_ci
    WHERE d.status='RESOLVED' AND d.refundStatus='PENDING' AND d.refundAmountFen>0 AND r.id IS NULL LIMIT 20`);
  for (const s of sources) { try { await request(s.sourceType,s.id); } catch (e) { console.error('[refund/prepare]',s.id,e.message); } }
  const pending = await query("SELECT * FROM payment_refunds WHERE status IN ('PENDING','PROCESSING','ABNORMAL') AND updatedAt<DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 MINUTE) ORDER BY updatedAt LIMIT 20");
  for (const r of pending) { try { await process(r); } catch (e) { console.error('[refund/retry]',r.id,e.message); } }
}
function start() {
  let running = false;
  const timer = setInterval(async () => { if(running)return;running=true;try { await sweep(); } catch(e) { console.error('[refund/sweep]',e.message); } finally { running=false; } },30000);
  timer.unref();
}
module.exports = { plan, prepare, apply, process, request, reconcile, sweep, start };
