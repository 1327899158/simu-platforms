'use strict';
/**
 * 支付服务：新单使用普通商户 API v3，历史云托管支付单沿用原通道。
 * 回调仅触发服务端查单，不把回调请求体当成可信的支付凭证。
 * 幂等：outTradeNo 唯一 + 事务内状态判断。
 */
const http = require('node:http');
const { err } = require('../lib/http');
const { newId, nowIso, parseDbDate } = require('../lib/util');
const { config } = require('../config');
const { query, queryOne, tx } = require('../db');
const {
  ensureConversation,
  systemMessage,
  publishConversationDoc,
  publishSystemMessage,
} = require('./chat-svc');
const PAYMENT_CLOCK_VERSION = 'utc-db-v2';

// 从 DATETIME 的文本原值计算 UTC 截止时间，避免驱动把它转换为本地 Date。
// 诊断仅记录订单标识和时间，不记录支付密钥、签名或请求体。
function paymentExpiry(order, phase) {
  const now = Date.now(), timeout = config.payTimeoutSec ?? 1800;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw err.conflict('PAY_TIMEOUT_SEC 必须为正整数，单位为秒');
  const source = order.paymentSelectedAtUtc ?? order.selectedAt;
  const selected = source ? parseDbDate(source).getTime() : now;
  const expires = selected + timeout * 1000;
  const valid = Number.isFinite(selected) && Number.isFinite(expires);
  console.log(JSON.stringify({
    evt: 'pay-window-check', paymentClock: PAYMENT_CLOCK_VERSION, phase, orderId: order.id,
    selectedAtRaw: source instanceof Date ? (Number.isFinite(source.getTime()) ? source.toISOString() : 'invalid') : source ?? null,
    selectedAtUtc: valid ? new Date(selected).toISOString() : null,
    expiresAtUtc: valid ? new Date(expires).toISOString() : null,
    nowUtc: new Date(now).toISOString(), payTimeoutSec: timeout, expired: valid && expires <= now,
  }));
  if (!valid) throw err.conflict('订单支付时间异常，请联系客服核查');
  if (expires <= now) throw err.conflict('支付时间已过，请返回订单等待报价恢复');
  return expires;
}

/**
 * 向微信云托管代签名网关发 HTTP 请求（内部地址，无需签名）。
 * 使用云托管统一下单/查单/关单接口，不混用微信支付 V3 URL。
 * 云托管内部自动处理：
 * 商户参数显式传 sub_mch_id，云平台负责底层支付通信。
 */
function paymentProvider() {
  if (config.paymentMode === 'mock') return 'mock';
  const provider = config.wxpayTransport || 'cloudbase';
  if (!['v3', 'cloudbase'].includes(provider)) throw err.conflict('微信支付通道配置无效');
  return provider;
}
function assertPaymentAccount(record) {
  if ((record.payMchid && record.payMchid !== config.wxpayMchid) || (record.payAppid && record.payAppid !== config.wxAppid)) throw err.conflict('该支付单的商户或 AppID 与当前配置不同，请恢复原配置处理');
}
function assertPaymentConfigured(provider, service) {
  if (provider === 'v3') return require('./wechat-pay-v3').assertConfigured();
  if (provider !== 'cloudbase') throw err.conflict('微信支付通道不可用');
  if (!config.wxpayMchid || !config.wxAppid) throw err.conflict('请配置微信支付商户号和小程序 AppID');
  if (!service || !config.cloudbaseEnv) throw err.conflict('请配置微信支付回调服务名和云环境');
}
function wxpayRequest(method, path, body, provider = paymentProvider()) {
  if (provider === 'v3') return require('./wechat-pay-v3').gateway(path, body);
  if (provider !== 'cloudbase') throw err.conflict('微信支付通道不可用');
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
async function createPayment(order, options = {}) {
  const coins = require('./coin-svc').amount(options.coins);
  return tx(async conn => {
    const [[current]] = await conn.execute("SELECT *, DATE_FORMAT(selectedAt,'%Y-%m-%d %H:%i:%s.%f') AS paymentSelectedAtUtc FROM orders WHERE id=? AND deletedAt IS NULL FOR UPDATE", [order.id]);
    if (!current || current.status !== 'AWAITING_PAYMENT' || current.selectedQuoteId !== order.selectedQuoteId) throw err.conflict('订单状态已变化，请刷新后支付');
    paymentExpiry(current, 'create-payment');
    const gross = Number(!coins && config.env !== 'production' && config.payAmountOverrideFen || current.finalAmountFen);
    if (!Number.isSafeInteger(gross) || gross <= 0) throw err.conflict('订单金额异常');
    const [[existing]] = await conn.execute(
      "SELECT * FROM payments WHERE orderId=? AND status='PENDING' AND COALESCE(grossAmountFen,amountFen)=? ORDER BY createdAt DESC LIMIT 1 FOR UPDATE",
      [current.id, gross]);
    if (existing) {
      assertPaymentAccount(existing);
      if(config.paymentMode==='mock' && existing.provider && existing.provider!=='mock')throw err.conflict('真实支付单不能改为模拟支付');
      if(Number(existing.coinAmount||0)!==coins)throw err.conflict('已有待支付单，请取消原支付单后调整抵扣');
      if(config.paymentMode==='wechat'&&Number(existing.amountFen)>0)assertPaymentConfigured(existing.provider||paymentProvider(),config.wxpayCallbackService||options.service);
      return existing;
    }
    const id = newId(), outTradeNo = newId();
    const provider = paymentProvider();
    if(config.paymentMode==='wechat'&&gross>coins)assertPaymentConfigured(provider,config.wxpayCallbackService||options.service);
    if(coins){
      await require('./coin-svc').reserve(conn,{userId:current.customerId,key:'ORDER:'+outTradeNo,kind:'ORDER',orderId:current.id,coins,gross});
      await conn.execute('INSERT INTO payments(id,orderId,outTradeNo,amountFen,grossAmountFen,coinAmount,createdAt,provider,payMchid,payAppid) VALUES(?,?,?,?,?,?,?,?,?,?)',[id,current.id,outTradeNo,gross-coins,gross,coins,nowIso(),provider,config.wxpayMchid||null,config.wxAppid||null]);
      return {id,orderId:current.id,outTradeNo,amountFen:gross-coins,grossAmountFen:gross,coinAmount:coins,status:'PENDING',provider,payMchid:config.wxpayMchid,payAppid:config.wxAppid};
    }
    await conn.execute('INSERT INTO payments(id,orderId,outTradeNo,amountFen,createdAt,provider,payMchid,payAppid) VALUES(?,?,?,?,?,?,?,?)',
      [id, current.id, outTradeNo, gross, nowIso(),provider,config.wxpayMchid||null,config.wxAppid||null]);
    return { id, orderId: current.id, outTradeNo, amountFen:gross, status: 'PENDING',provider,payMchid:config.wxpayMchid,payAppid:config.wxAppid };
  });
}

// 回调内容只作为查单线索；支付事实从服务端微信支付查询结果取得。
async function reconcilePayment(outTradeNo) {
  if (config.paymentMode !== 'wechat') throw err.notFound('真实支付未开启');
  if (typeof outTradeNo !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(outTradeNo)) throw err.bad('支付单号不合法');
  if (!config.wxpayMchid || !config.wxAppid) throw err.conflict('请配置微信支付商户号和小程序 AppID');
  const payment = await queryOne('SELECT * FROM payments WHERE outTradeNo=?', [outTradeNo]);
  if (!payment) throw err.notFound('支付单不存在');
  if(Number(payment.amountFen)===0)return confirmCoinPayment(payment);
  assertPaymentAccount(payment);
  if (payment.provider === 'mock') throw err.conflict('模拟支付单不能确认为微信付款');
  const response = await wxpayRequest('POST', '/queryorder', { out_trade_no: outTradeNo, sub_mch_id: config.wxpayMchid }, payment.provider || paymentProvider());
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
 * 按支付单记录的通道发起 JSAPI 下单。
 * 返回 wx.requestPayment 五参数，v3 使用商户私钥 RSA 签名。
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
  const service = config.wxpayCallbackService || context.service;
  const payment = await createPayment(order, context);
  if(Number(payment.amountFen)===0){
    await confirmCoinPayment(payment);
    return {mode:'coins',paid:true,amountFen:0,coinAmount:Number(payment.coinAmount),grossAmountFen:Number(payment.grossAmountFen)};
  }
  const provider = payment.provider || paymentProvider();
  assertPaymentConfigured(provider, service);
  // 与取消操作共享订单锁，不能在云端尚在创建支付单时释放抵扣余额。
  const response = await tx(async conn=>{
    const [[currentOrder]]=await conn.execute("SELECT *, DATE_FORMAT(selectedAt,'%Y-%m-%d %H:%i:%s.%f') AS paymentSelectedAtUtc FROM orders WHERE id=? FOR UPDATE",[order.id]);
    const [[current]]=await conn.execute('SELECT * FROM payments WHERE outTradeNo=? FOR UPDATE',[payment.outTradeNo]);
    if(!currentOrder||currentOrder.deletedAt||currentOrder.status!=='AWAITING_PAYMENT'||current?.status!=='PENDING')throw err.conflict('支付单已变化，请刷新');
    const expiresAt = paymentExpiry(currentOrder, 'unifiedorder');
    return wxpayRequest('POST', '/unifiedorder', {
    body: '仿真服务·' + String(order.projectName || '').slice(0, 30),
    out_trade_no: payment.outTradeNo, sub_mch_id: config.wxpayMchid,
    total_fee: Number(payment.amountFen), openid,
    spbill_create_ip: context.clientIp || '127.0.0.1',
    env_id: config.cloudbaseEnv, callback_type: 2,
    container: { service, path: '/api/pay/notify' },
    ...(provider==='v3'?{time_expire: new Date(expiresAt).toISOString()}:{}),
    }, provider);
  });
  const result = cloudPayResult(response, '下单');
  const params = result.payment;
  if (!params || !params.timeStamp || !params.nonceStr || !params.package || !params.paySign) {
    throw err.bad('微信支付下单未返回完整调起参数');
  }
  return { mode: 'wechat', outTradeNo: payment.outTradeNo, amountFen: Number(payment.amountFen),coinAmount:Number(payment.coinAmount||0),grossAmountFen:Number(payment.grossAmountFen??payment.amountFen),
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
    if(mock && p.provider && p.provider!=='mock')throw err.forbidden('真实支付单不能模拟落账');
    if (!transactionId || typeof transactionId !== 'string') throw err.bad('缺少支付流水号');
    if (!mock && (rawEvent?.trade_state !== 'SUCCESS' || rawEvent?.out_trade_no !== outTradeNo
      || rawEvent?.amount?.currency !== 'CNY' || !Number.isSafeInteger(Number(rawEvent?.amount?.total))
      || Number(rawEvent.amount.total) !== Number(p.amountFen))) throw err.conflict('支付金额或币种不匹配');
    if (p.status === 'SUCCESS') {
      if (p.transactionId !== transactionId) throw err.conflict('支付流水不匹配');
      return { applied: false, reason: 'already-success' };
    }
    const canAdvance = p.status === 'PENDING';
    if(Number(p.coinAmount))await require('./coin-svc').commit(conn,'ORDER:'+p.outTradeNo,p.coinAmount);

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
async function confirmCoinPayment(p){
  if(Number(p.amountFen)!==0||Number(p.coinAmount)<=0||Number(p.coinAmount)!==Number(p.grossAmountFen))throw err.conflict('全额仿真币支付金额不匹配');
  return applyPaymentSuccess(p.outTradeNo,'COINS_'+p.outTradeNo,{trade_state:'SUCCESS',out_trade_no:p.outTradeNo,amount:{total:0,currency:'CNY'},coinsOnly:true});
}
async function closeUnpaidTrade(outTradeNo, provider = paymentProvider()){
  const r=await wxpayRequest('POST','/queryorder',{out_trade_no:outTradeNo,sub_mch_id:config.wxpayMchid},provider);
  if(r.status===200&&(r.body?.err_code||r.body?.errCode)==='ORDERNOTEXIST')return {paid:false};
  const b=cloudPayResult(r,'取消查单'),state=b.trade_state||b.tradeState;
  if((b.out_trade_no||b.outTradeNo)!==outTradeNo||(b.sub_appid||b.subAppid||b.appid||b.appId)!==config.wxAppid||String(b.sub_mch_id||b.subMchId||b.mch_id||b.mchId||'')!==config.wxpayMchid)throw err.conflict('支付订单归属不匹配');
  if(state==='SUCCESS')return {paid:true};
  if(!['NOTPAY','USERPAYING','CLOSED','REVOKED','PAYERROR'].includes(state))throw err.conflict('支付状态待确认，请稍后重试');
  if(state!=='CLOSED')cloudPayResult(await wxpayRequest('POST','/closeorder',{out_trade_no:outTradeNo,sub_mch_id:config.wxpayMchid},provider),'取消支付');
  return {paid:false};
}
async function cancelPayment(order,userId){
  const result=await tx(async c=>{
    const [[o]]=await c.execute('SELECT * FROM orders WHERE id=? AND customerId=? FOR UPDATE',[order,userId]);
    if(!o)throw err.notFound('订单不存在');
    const [[current]]=await c.execute("SELECT * FROM payments WHERE orderId=? AND status='PENDING' ORDER BY createdAt DESC LIMIT 1 FOR UPDATE",[order]);
    if(!current)return {cancelled:true};
    if(config.paymentMode==='mock' && current.provider && current.provider!=='mock')throw err.conflict('真实支付单需要开启原支付通道后取消');
    if(Number(current.amountFen)===0)return {paid:true,coinPayment:current};
    assertPaymentAccount(current);
    if(current.provider==='mock'&&config.paymentMode==='wechat')throw err.conflict('请联系管理员清理历史模拟支付单');
    if(config.paymentMode==='wechat'&&(await closeUnpaidTrade(current.outTradeNo,current.provider||paymentProvider())).paid)return {paid:true,outTradeNo:current.outTradeNo};
    if(Number(current.coinAmount))await require('./coin-svc').release(c,'ORDER:'+current.outTradeNo);
    await c.execute("UPDATE payments SET status='FAILED' WHERE outTradeNo=? AND status='PENDING'",[current.outTradeNo]);
    return {cancelled:true};
  });
  if(result.coinPayment)await confirmCoinPayment(result.coinPayment);
  else if(result.outTradeNo)await reconcilePayment(result.outTradeNo);
  return {paid:!!result.paid,cancelled:!!result.cancelled};
}
async function sweepExpiredAwaitingPayment() {
  const deadline = new Date(Date.now() - config.payTimeoutSec * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const rows = await query(
    `SELECT id, selectedQuoteId FROM orders
     WHERE status = 'AWAITING_PAYMENT' AND selectedAt < ?`, [deadline]
  );
  let reverted = 0;
  for (const o of rows) {
    try {
      // 与下单、取消和支付回调采用相同锁顺序；关单结束前不释放余额。
      const result = await tx(async (conn) => {
        const [[currentOrder]]=await conn.execute("SELECT * FROM orders WHERE id=? AND status='AWAITING_PAYMENT' AND selectedQuoteId=? AND selectedAt<? FOR UPDATE",[o.id,o.selectedQuoteId,deadline]);
        if(!currentOrder)return {changed:false};
        const [currentPayments]=await conn.execute("SELECT outTradeNo,status,amountFen,coinAmount,grossAmountFen,provider,payMchid,payAppid FROM payments WHERE orderId=? AND status IN ('PENDING','SUCCESS') FOR UPDATE",[o.id]);
        if(currentPayments.some(p=>p.status==='SUCCESS'))return {changed:false};
        if(config.paymentMode==='mock' && currentPayments.some(p=>p.provider && p.provider!=='mock'))return {changed:false};
        for(const p of currentPayments){
          assertPaymentAccount(p);
          if(Number(p.amountFen)===0&&Number(p.coinAmount)>0)return {coinPayment:p};
          if(p.provider==='mock'&&config.paymentMode==='wechat')throw err.conflict('历史模拟支付单不可自动关单');
          if(config.paymentMode==='wechat'&&(await closeUnpaidTrade(p.outTradeNo,p.provider||paymentProvider())).paid)return {outTradeNo:p.outTradeNo};
        }
        const [r] = await conn.execute(
          `UPDATE orders SET status='QUOTING', selectedQuoteId=NULL,
             finalAmountFen=NULL, selectedAt=NULL, updatedAt=?
           WHERE id=? AND status='AWAITING_PAYMENT' AND selectedQuoteId=? AND selectedAt < ?`,
          [nowIso(), o.id, o.selectedQuoteId, deadline]
        );
        if (!r.affectedRows) return {changed:false};
        await conn.execute(
          `UPDATE quotes SET status='PENDING', updatedAt=?
           WHERE orderId=? AND status IN ('SELECTED','REJECTED')`,
          [nowIso(), o.id]
        );
        for(const p of currentPayments)if(Number(p.coinAmount)>0)await require('./coin-svc').release(conn,'ORDER:'+p.outTradeNo);
        await conn.execute(`UPDATE payments SET status='FAILED' WHERE orderId=? AND status='PENDING'`,[o.id]);
        return {changed:true};
      });
      if(result.coinPayment){await confirmCoinPayment(result.coinPayment);continue;}
      if(result.outTradeNo){await reconcilePayment(result.outTradeNo);continue;}
      const changed=result.changed;
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
    try { await sweepExpiredAwaitingPayment(); await require('./exposure-svc').sweepExpired(); } catch (e) { console.error('sweep error', e); }
    finally { running = false; }
  }, 30 * 1000);
  if (timer.unref) timer.unref();
}

module.exports = { PAYMENT_CLOCK_VERSION, paymentProvider, assertPaymentAccount, assertPaymentConfigured, wxpayRequest, cloudPayResult, closeUnpaidTrade, reconcilePayment, createPayment, createJsapiOrder, confirmCoinPayment, cancelPayment, applyPaymentSuccess, sweepExpiredAwaitingPayment, startSweeper };
