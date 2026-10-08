'use strict';
// 普通商户 API v3。私钥和微信支付公钥只从服务端密钥配置加载。
const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const { config } = require('../config');
const { err } = require('../lib/http');
let cachedKeys;

function keys() {
  const c = config;
  const identity = [c.wxpayPrivateKeyPath, c.wxpayPublicKeyPath, c.wxpayPublicKeyId,c.wxpayPrivateKeyBase64,c.wxpayPublicKeyBase64].join('|');
  if (cachedKeys?.identity === identity) return cachedKeys;
  try {
    const privateKey = crypto.createPrivateKey(c.wxpayPrivateKeyBase64 ? Buffer.from(c.wxpayPrivateKeyBase64,'base64') : fs.readFileSync(c.wxpayPrivateKeyPath));
    const publicKey = crypto.createPublicKey(c.wxpayPublicKeyBase64 ? Buffer.from(c.wxpayPublicKeyBase64,'base64') : fs.readFileSync(c.wxpayPublicKeyPath));
    for (const key of [privateKey, publicKey]) {
      if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) throw Error('RSA 2048 required');
    }
    cachedKeys = { identity, privateKey, publicKey };
    return cachedKeys;
  } catch { throw err.conflict('微信支付密钥文件配置无效，请联系管理员'); }
}

function notifyUrl(path) {
  let url;
  try { url = new URL(config.wxpayNotifyBaseUrl); } catch { throw err.conflict('请配置微信支付公网 HTTPS 回调地址'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw err.conflict('微信支付回调地址必须为无路径、参数的公网 HTTPS 域名');
  }
  return new URL(path, url).href;
}

function assertConfigured() {
  if (!/^[0-9]{6,32}$/.test(config.wxpayMchid || '') || !/^wx[a-zA-Z0-9]{16}$/.test(config.wxAppid || '')
    || !/^[A-Fa-f0-9]{8,64}$/.test(config.wxpaySerialNo || '')
    || !/^PUB_KEY_ID_[A-Za-z0-9_]+$/.test(config.wxpayPublicKeyId || '')
    || Buffer.byteLength(config.wxpayApiV3Key || '') !== 32) {
    throw err.conflict('微信支付 API v3 配置不完整，请配置商户号、AppID、证书序列号、公钥 ID 和 APIv3 密钥');
  }
  notifyUrl('/api/pay/v3/notify');
  keys();
}
function sign(message) {
  return crypto.sign('RSA-SHA256', Buffer.from(message), keys().privateKey).toString('base64');
}
function authorization(method, path, body, timestamp, nonce) {
  const signature = sign(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${config.wxpayMchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${config.wxpaySerialNo}",signature="${signature}"`;
}
function verify(headers, rawBody, now = Date.now()) {
  const timestamp = headers['wechatpay-timestamp'], nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'], serial = headers['wechatpay-serial'];
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300
    || typeof nonce !== 'string' || !nonce || nonce.length > 128
    || typeof signature !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
    || serial !== config.wxpayPublicKeyId) throw err.forbidden('微信支付签名或时间戳无效');
  const message = Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`), Buffer.from(rawBody), Buffer.from('\n')]);
  if (!crypto.verify('RSA-SHA256', message, keys().publicKey, Buffer.from(signature, 'base64'))) throw err.forbidden('微信支付验签失败');
}

function request(method, path, body) {
  assertConfigured();
  if (!path.startsWith('/v3/') || /[\r\n]/.test(path)) throw err.bad('微信支付接口路径无效');
  const raw = body ? JSON.stringify(body) : '';
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: 'api.mch.weixin.qq.com', path, method,
      headers: { Authorization: authorization(method, path, raw, timestamp, nonce),
        Accept: 'application/json', 'Content-Type': 'application/json',
        'Wechatpay-Serial': config.wxpayPublicKeyId, 'User-Agent': 'simu-platform/wechat-pay-v3',
        'Content-Length': Buffer.byteLength(raw) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > 1024 * 1024) res.destroy(Error('微信支付响应过大')); else chunks.push(c);
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          const bytes = Buffer.concat(chunks);
          // 官方 SDK 仅强制对 2xx 响应验签；错误响应可能没有签名。
          // 有签名的错误响应仍校验；缺签名的 2xx 一律不能作为付款/关单凭证。
          if ((res.statusCode >= 200 && res.statusCode < 300) || res.headers['wechatpay-signature']) verify(res.headers, bytes);
          const result = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
          resolve({ status: res.statusCode, body: result });
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(10000, () => req.destroy(Error('微信支付接口请求超时')));
    req.on('error', reject);
    req.end(raw);
  });
}
function result(response, action) {
  if (response.status < 200 || response.status >= 300) {
    throw err.bad(`微信支付${action}失败：${String(response.body?.code || response.status)} ${String(response.body?.message || '').slice(0, 120)}`);
  }
  return response.body;
}
function paymentParams(prepayId) {
  if (typeof prepayId !== 'string' || !prepayId || prepayId.length > 128) throw err.conflict('微信支付预支付标识无效');
  const timeStamp = String(Math.floor(Date.now() / 1000)), nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = 'prepay_id=' + prepayId;
  return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign: sign(`${config.wxAppid}\n${timeStamp}\n${nonceStr}\n${pkg}\n`) };
}

function decryptNotification(headers, rawBody) {
  assertConfigured();
  verify(headers, rawBody);
  let envelope, resource;
  try { envelope = JSON.parse(rawBody.toString('utf8')); resource = envelope.resource; } catch { throw err.bad('微信支付通知格式无效'); }
  if (envelope.resource_type !== 'encrypt-resource' || resource?.algorithm !== 'AEAD_AES_256_GCM'
    || typeof resource.nonce !== 'string' || Buffer.byteLength(resource.nonce) !== 12
    || typeof resource.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(resource.ciphertext)
    || (resource.associated_data !== undefined && typeof resource.associated_data !== 'string')) throw err.bad('微信支付加密资源无效');
  try {
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    if (ciphertext.length <= 16) throw Error('short ciphertext');
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(config.wxpayApiV3Key), Buffer.from(resource.nonce));
    decipher.setAuthTag(ciphertext.subarray(-16));
    decipher.setAAD(Buffer.from(resource.associated_data || ''));
    const data = JSON.parse(Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString('utf8'));
    if (data.mchid !== config.wxpayMchid) throw Error('merchant mismatch');
    return { eventType: envelope.event_type, originalType: resource.original_type, data };
  } catch { throw err.forbidden('微信支付通知解密或商户校验失败'); }
}

// 与历史云托管网关共用业务服务的输入输出；这里实际调用的是普通商户 API v3。
async function gateway(path, body) {
  const outTradeNo = body.out_trade_no;
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(outTradeNo || '')) throw err.bad('微信支付单号无效');
  const urlNo = encodeURIComponent(outTradeNo);
  if (path === '/unifiedorder') {
    if (!Number.isSafeInteger(body.total_fee) || body.total_fee <= 0 || !body.openid) throw err.bad('支付金额或支付用户无效');
    const callback = body.container?.path === '/api/exposure-pay/notify' ? '/api/exposure-pay/v3/notify' : '/api/pay/v3/notify';
    const b = result(await request('POST', '/v3/pay/transactions/jsapi', {
      appid: config.wxAppid, mchid: config.wxpayMchid, description: body.body,
      out_trade_no: outTradeNo, notify_url: notifyUrl(callback),
      ...(body.time_expire ? { time_expire: body.time_expire } : {}),
      amount: { total: body.total_fee, currency: 'CNY' }, payer: { openid: body.openid },
    }), '下单');
    return { status: 200, body: { return_code: 'SUCCESS', result_code: 'SUCCESS', payment: paymentParams(b.prepay_id) } };
  }
  if (path === '/queryorder') {
    const r = await request('GET', `/v3/pay/transactions/out-trade-no/${urlNo}?mchid=${encodeURIComponent(config.wxpayMchid)}`);
    // 来自固定微信域名、TLS 认证连接的官方明确不存在响应，不能把网络错误当作不存在。
    if (r.status === 404 && r.body.code === 'ORDER_NOT_EXIST') return { status: 200, body: { err_code: 'ORDERNOTEXIST' } };
    const b = result(r, '查单');
    return { status: 200, body: { ...b, return_code: 'SUCCESS', result_code: 'SUCCESS',
      mch_id: b.mchid, total_fee: b.amount?.total, fee_type: b.amount?.currency } };
  }
  if (path === '/closeorder') {
    result(await request('POST', `/v3/pay/transactions/out-trade-no/${urlNo}/close`, { mchid: config.wxpayMchid }), '关单');
    return { status: 200, body: { return_code: 'SUCCESS', result_code: 'SUCCESS' } };
  }
  throw err.bad('微信支付接口未支持');
}
module.exports = { assertConfigured, notifyUrl, authorization, verify, request, result, paymentParams, decryptNotification, gateway };
