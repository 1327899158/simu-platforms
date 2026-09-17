'use strict';
const crypto = require('node:crypto');
const { readJson, ok, err } = require('../lib/http');
const { tx, queryOne } = require('../db');
const { nowIso, parseDbDate, maskPhone, v } = require('../lib/util');
const { sendSmsCode, verifySmsCode } = require('../services/sms-svc');
const { consumeWindow, getClientIp } = require('../services/auth-rate-svc');
const digest = token => crypto.createHash('sha256').update(token).digest('hex');

function eligible(user) {
  if (!user || user.deletedAt || user.status !== 'ACTIVE' || !user.phone) throw err.conflict('账号不可用或未绑定手机号');
  if (user.phoneChangedAt && Date.now() - parseDbDate(user.phoneChangedAt).getTime() < 30 * 86400000) {
    throw err.conflict('30天内只可更换一次手机号，请满30天后再试');
  }
}
function grant(user, token) {
  if (!token || !user.phoneChangeToken || digest(token) !== user.phoneChangeToken ||
      !user.phoneChangeExpiresAt || parseDbDate(user.phoneChangeExpiresAt).getTime() <= Date.now()) {
    throw err.conflict('原手机号验证已失效，请重新验证');
  }
}
async function target(req, body) {
  const username = v.str(body.username, '账号', { min: 6, max: 12 });
  if (!/^\d+$/.test(username)) throw err.bad('账号格式不正确');
  for (const [scope, key, limit] of [['PHONE_CHANGE_IP', getClientIp(req), 40], ['PHONE_CHANGE_ACCOUNT', username, 20]]) {
    const state = await consumeWindow(scope, key, limit, 15 * 60);
    if (!state.allowed) throw err.tooMany('操作过于频繁，请15分钟后再试');
  }
  const user = await queryOne('SELECT * FROM users WHERE username = ?', [username]);
  eligible(user);
  return user;
}
function register(router) {
  router.post('/api/auth/phone-change/sms', async (req, res) => {
    const b = await readJson(req), user = await target(req, b);
    const stage = v.oneOf(b.stage, '验证步骤', ['OLD', 'NEW']);
    let phone = user.phone;
    if (stage === 'NEW') {
      grant(user, v.str(b.token, '验证凭证', { min: 64, max: 64 }));
      phone = v.str(b.phone, '新手机号', { min: 11, max: 11 });
      if (!/^1\d{10}$/.test(phone)) throw err.bad('手机号格式不正确');
      if (phone === user.phone) throw err.conflict('新手机号不能与原手机号相同');
      if (await queryOne('SELECT id FROM users WHERE phone = ?', [phone])) throw err.conflict('该手机号已被其他账号绑定');
    }
    ok(res, { ...await sendSmsCode(phone, 'CHANGE_' + stage, getClientIp(req)), phoneMasked: maskPhone(phone) });
  });
  router.post('/api/auth/phone-change/verify-old', async (req, res) => {
    const b = await readJson(req), user = await target(req, b);
    const code = v.str(b.smsCode, '验证码', { min: 6, max: 6 });
    const token = crypto.randomBytes(32).toString('hex');
    await tx(async conn => {
      const [[current]] = await conn.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [user.id]);
      eligible(current);
      await verifySmsCode(current.phone, code, 'CHANGE_OLD', { conn });
      await conn.execute('UPDATE users SET phoneChangeToken = ?, phoneChangeExpiresAt = DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE) WHERE id = ?', [digest(token), user.id]);
    });
    ok(res, { token });
  });
  router.post('/api/auth/phone-change/confirm', async (req, res) => {
    const b = await readJson(req), user = await target(req, b);
    const phone = v.str(b.phone, '新手机号', { min: 11, max: 11 });
    const code = v.str(b.smsCode, '验证码', { min: 6, max: 6 });
    const token = v.str(b.token, '验证凭证', { min: 64, max: 64 });
    if (!/^1\d{10}$/.test(phone)) throw err.bad('手机号格式不正确');
    try {
      await tx(async conn => {
        const [[current]] = await conn.execute('SELECT * FROM users WHERE id = ? FOR UPDATE', [user.id]);
        eligible(current);
        grant(current, token);
        if (phone === current.phone) throw err.conflict('新手机号不能与原手机号相同');
        const [[occupied]] = await conn.execute('SELECT id FROM users WHERE phone = ?', [phone]);
        if (occupied) throw err.conflict('该手机号已被其他账号绑定');
        await verifySmsCode(phone, code, 'CHANGE_NEW', { conn });
        await conn.execute(`UPDATE users SET phone = ?, phoneChangedAt = UTC_TIMESTAMP(3),
          phoneChangeToken = NULL, phoneChangeExpiresAt = NULL, sessionToken = NULL,
          sessionExpiresAt = NULL, updatedAt = ? WHERE id = ?`, [phone, nowIso(), user.id]);
        await conn.execute('UPDATE identity_verifications SET phone = ?, updatedAt = ? WHERE userId = ?', [phone, nowIso(), user.id]);
        // 旧手机未使用的登录/找回验证码不能继续用于此账户。
        await conn.execute('UPDATE sms_codes SET usedAt = ? WHERE phone = ? AND usedAt IS NULL', [nowIso(), current.phone]);
      });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') throw err.conflict('该手机号已被其他账号绑定');
      throw e;
    }
    ok(res, { message: '手机号更换成功，请重新登录' });
  });
}
module.exports = { register, eligible, grant };
