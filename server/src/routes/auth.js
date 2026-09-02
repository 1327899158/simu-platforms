'use strict';
/**
 * 认证路由（云开发版）。
 *
 * 主登录方式：wx.cloud.callContainer 自动注入 X-WX-OPENID，不需要 wx.login code，
 * 服务端直接用 openid 建账号/查账号。
 *
 * POST /api/auth/wx-login  { roleHint?: 'customer'|'engineer', nickname?, avatarUrl? }
 *   → 自动注册/登录，返回用户信息（无 token）
 *
 * GET  /api/me              → 返回当前用户信息
 * PATCH /api/me             → 更新昵称、头像 fileID、工程师资料
 */
const { readJson, ok, err } = require('../lib/http');
const fs = require('node:fs');
const https = require('node:https');
const { newId, nowIso, maskPhone, v } = require('../lib/util');
const { query, queryOne, tx } = require('../db');
const { requireUser, getOrCreateUser, switchUserRole, getOpenid } = require('../lib/auth-mw');
const { parseJson } = require('../db');
const { config } = require('../config');
const { ensureIdentityRecord } = require('../services/identity-svc');

const WECHAT_TOKEN_FILE = '/.tencentcloudbase/wx/cloudbase_access_token';
const wechatAccessTokenCache = { token: '', expiresAt: 0, pending: null };

function getWechatCloudbaseToken() {
  const envToken = String(process.env.WX_CLOUDBASE_ACCESSTOKEN || '').trim();
  if (envToken) return { token: envToken, source: 'env' };
  try {
    const token = fs.readFileSync(WECHAT_TOKEN_FILE, 'utf8').trim();
    if (token) return { token, source: 'mounted-file' };
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return null;
}

function wechatHttpsJson({ path, method = 'GET', payload }) {
  const postData = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'api.weixin.qq.com',
      path, method,
      headers: postData
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        : undefined,
      timeout: 10000,
    }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let body = null;
        try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = null; }
        resolve({
          statusCode: Number(response.statusCode || 0), body, raw: raw.slice(0, 500),
          location: response.headers?.location || '',
        });
      });
    });
    request.on('timeout', () => request.destroy(new Error('微信接口请求超时')));
    request.on('error', reject);
    if (postData) request.write(postData);
    request.end();
  });
}

function appAccessTokenMessage(body) {
  const code = Number(body?.errcode || 0);
  if (code === 40013) return 'WX_APPID 无效，请核对小程序 AppID';
  if (code === 40125) return 'WX_APPSECRET 无效，请在微信公众平台重置后更新云托管环境变量';
  if (code === 40164) return '微信接口 IP 白名单未包含当前云托管出口 IP';
  return `获取微信 access_token 失败${code ? `（${code}: ${body?.errmsg || '未知错误'}）` : ''}`;
}

async function getWechatAppAccessToken() {
  const now = Date.now();
  if (wechatAccessTokenCache.token && wechatAccessTokenCache.expiresAt > now + 60 * 1000) {
    return wechatAccessTokenCache.token;
  }
  if (wechatAccessTokenCache.pending) return wechatAccessTokenCache.pending;
  if (!config.wxAppid || !config.wxAppsecret) {
    throw new Error('当前 CloudBase 未提供微信令牌，请在 simu-api 环境变量中配置 WX_APPSECRET');
  }
  wechatAccessTokenCache.pending = (async () => {
    const response = await wechatHttpsJson({
      path: '/cgi-bin/token?grant_type=client_credential'
        + `&appid=${encodeURIComponent(config.wxAppid)}`
        + `&secret=${encodeURIComponent(config.wxAppsecret)}`,
    });
    const body = response.body || {};
    if (response.statusCode !== 200 || !body.access_token) {
      throw new Error(appAccessTokenMessage(body));
    }
    const expiresIn = Math.max(300, Number(body.expires_in || 7200));
    wechatAccessTokenCache.token = body.access_token;
    wechatAccessTokenCache.expiresAt = Date.now() + Math.max(60, expiresIn - 300) * 1000;
    return body.access_token;
  })();
  try {
    return await wechatAccessTokenCache.pending;
  } finally {
    wechatAccessTokenCache.pending = null;
  }
}

async function getWechatApiCredential() {
  const cloudbase = getWechatCloudbaseToken();
  if (cloudbase) return { queryName: 'cloudbase_access_token', ...cloudbase };
  return { queryName: 'access_token', token: await getWechatAppAccessToken(), source: 'app-secret' };
}

async function wechatOpenApiPost(path, payload) {
  const { queryName, token, source: tokenSource } = await getWechatApiCredential();
  const response = await wechatHttpsJson({
    path: `${path}?${queryName}=${encodeURIComponent(token)}`,
    method: 'POST', payload,
  });
  return { ...response, tokenSource };
}

function phoneExchangeMessage(response) {
  const body = response?.body || {};
  const code = Number(body.errcode || 0);
  if (code === 40029 || code === 40163) return '手机号授权凭证已失效或已使用，请重新点击手机号框授权';
  if ([40001, 40014, 41001, 42001].includes(code)) {
    return '微信调用凭证无效，请检查 WX_APPID、WX_APPSECRET 或微信令牌配置';
  }
  if (code === 48001) return '当前小程序或云托管服务未开通获取手机号接口权限';
  if (code === -1) return '微信服务繁忙，请稍后重试';
  if (code) return `微信接口错误 ${code}: ${body.errmsg || '未知错误'}`;
  if ([301, 302, 307, 308].includes(response?.statusCode)) {
    return '微信开放接口发生异常重定向，请检查微信调用凭证配置';
  }
  if (response?.statusCode === 401 || response?.statusCode === 403) {
    return '微信开放接口未授权，请检查小程序获取手机号能力和调用凭证';
  }
  if (!response?.body) return `微信开放接口返回异常（HTTP ${response?.statusCode || 0}）`;
  return `微信开放接口调用失败（HTTP ${response?.statusCode || 0}）`;
}

async function exchangeWechatPhone(code) {
  let response;
  try {
    response = await wechatOpenApiPost('/wxa/business/getuserphonenumber', { code });
  } catch (e) {
    console.warn(JSON.stringify({
      t: new Date().toISOString(), evt: 'wechat-phone-exchange-unavailable',
      cloudbaseEnv: config.cloudbaseEnv || null, error: e.message,
    }));
    throw e;
  }
  const body = response.body || {};
  if (response.statusCode < 200 || response.statusCode >= 300 || (body.errcode && body.errcode !== 0)) {
    console.warn(JSON.stringify({
      t: new Date().toISOString(), evt: 'wechat-phone-exchange-failed',
      apiPath: '/wxa/business/getuserphonenumber',
      statusCode: response.statusCode, errcode: body.errcode || null,
      tokenSource: response.tokenSource, redirected: Boolean(response.location),
      errmsg: body.errmsg || response.raw || 'empty response',
    }));
    throw new Error(phoneExchangeMessage(response));
  }
  const phoneNumber = body.phone_info?.phoneNumber || body.phone_info?.purePhoneNumber;
  if (!phoneNumber) throw new Error('微信接口未返回手机号');
  return phoneNumber;
}

function userView(u, profile, identity) {
  return {
    id: u.id,
    role: u.role,
    nickname: u.nickname,
    avatarUrl: u.avatarUrl || null,
    openid: u.openid,
    username: u.username,
    hasPassword: Boolean(u.passwordHash),
    // 完整手机号仅保留在服务端，任何用户视图都只返回脱敏值。
    hasPhone: Boolean(u.phone),
    phoneMasked: maskPhone(u.phone),
    // 与账号/手机号登录返回结构保持一致，前端可直接读取认证状态
    verifyStatus: identity?.verifyStatus || 'PENDING',
    identity: identity ? {
      verifyStatus: identity.verifyStatus || 'PENDING',
      reviewReason: identity.reviewReason || '',
      submittedAt: identity.submittedAt || null,
      hasSubmitted: Boolean(identity.submittedAt),
      fileCount: Number(identity.fileCount || 0),
    } : { verifyStatus: 'PENDING', reviewReason: '', submittedAt: null, hasSubmitted: false },
    engineer: profile
      ? {
          ...profile,
          verifyStatus: identity?.verifyStatus || profile.verifyStatus || 'PENDING',
          specialties: parseJson(profile.specialties),
          softwares: parseJson(profile.softwares),
        }
      : null,
  };
}

async function loadUserView(id) {
  const u = await queryOne(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!u) return null;
  const profile = u.role === 'ENGINEER'
    ? await queryOne(`SELECT * FROM engineer_profiles WHERE userId = ?`, [u.id])
    : null;
  const identity = await ensureIdentityRecord(u);
  const count = await queryOne(
    `SELECT COUNT(*) AS count FROM identity_verification_files WHERE userId = ? AND purpose = 'SUPPORTING'`, [u.id]
  );
  identity.fileCount = Number(count.count || 0);
  if (profile) {
    profile.qualificationFileCount = Number(count.count || 0);
  }
  return userView(u, profile, identity);
}

function register(router) {
  // POST /api/auth/wx-login { roleHint?, nickname?, avatarUrl? }
  // 云开发版：openid 从 X-WX-OPENID 头取，无需 jscode2session
  //
  // 语义：
  //   - 未登录 openid → 按 roleHint 首登建档
  //   - 已存在用户  → 显式按 roleHint 切换角色（客户 <-> 工程师）
  //   - session token（账号/手机号登录）→ 走 switchUserRole 直接改角色
  router.post('/api/auth/wx-login', async (req, res) => {
    const body = await readJson(req);
    const roleHint = body.roleHint === 'engineer' ? 'ENGINEER' : 'CUSTOMER';

    // 1. 先按"只读"语义拿到当前用户（openid 首登在这里自动建档，
    //    但对已存在用户不会改角色）
    let user = await requireUser(req, roleHint);

    // 2. 如需切换角色，由此 handler 显式完成
    if (user.role !== roleHint) {
      user = await switchUserRole(user, roleHint);
    }

    // 更新昵称 / 头像（首次登录时一并写入）
    const nickname = body.nickname ? v.str(body.nickname, '昵称', { max: 60, optional: true }) : null;
    const avatarUrl = body.avatarUrl ? v.str(body.avatarUrl, '头像URL', { max: 512, optional: true }) : null;
    if (nickname || avatarUrl) {
      const now = nowIso();
      await query(
        `UPDATE users SET
           nickname = COALESCE(?, nickname),
           avatarUrl = COALESCE(?, avatarUrl),
           updatedAt = ?
         WHERE id = ?`,
        [nickname, avatarUrl, now, user.id]
      );
    }

    const view = await loadUserView(user.id);
    ok(res, { isNew: !user.nickname, user: view });
  });

  // GET /api/me
  router.get('/api/me', async (req, res) => {
    const user = await requireUser(req);
    ok(res, await loadUserView(user.id));
  });

  // PATCH /api/me { nickname?, avatarUrl?, engineer?: { specialties?, softwares?, intro?, realName? } }
  router.patch('/api/me', async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    const now = nowIso();

    const nickname = v.str(body.nickname, '昵称', { min: 1, max: 60, optional: true });
    // 云开发版：avatarUrl 直接是云存储临时链接或 fileID（由前端传入）
    const avatarUrl = v.str(body.avatarUrl, '头像', { max: 512, optional: true });

    if (nickname !== undefined || avatarUrl !== undefined) {
      await query(
        `UPDATE users SET
           nickname = COALESCE(?, nickname),
           avatarUrl = COALESCE(?, avatarUrl),
           updatedAt = ?
         WHERE id = ?`,
        [nickname ?? null, avatarUrl ?? null, now, user.id]
      );
    }

    if (body.engineer && user.role === 'ENGINEER') {
      const e = body.engineer;
      await query(
        `UPDATE engineer_profiles SET
           realName    = COALESCE(?, realName),
           intro       = COALESCE(?, intro),
           specialties = COALESCE(?, specialties),
           softwares   = COALESCE(?, softwares)
         WHERE userId = ?`,
        [
          v.str(e.realName, '姓名', { max: 30, optional: true }) ?? null,
          v.str(e.intro, '简介', { max: 500, optional: true }) ?? null,
          e.specialties ? JSON.stringify(v.arr(e.specialties, '专业方向', { maxLen: 20 })
            .map((item) => v.str(item, '专业方向', { min: 1, max: 60 }))) : null,
          e.softwares ? JSON.stringify(v.arr(e.softwares, '擅长软件', { maxLen: 20 })
            .map((item) => v.str(item, '擅长软件', { min: 1, max: 60 }))) : null,
          user.id,
        ]
      );
    }

    ok(res, await loadUserView(user.id));
  });

  // POST /api/dev/promote-engineer —— 演示阶段自主认证，正式环境可通过配置关闭
  router.post('/api/dev/promote-engineer', async (req, res) => {
    if (!config.allowEngineerSelfVerify) {
      throw err.forbidden('工程师自主认证未开启，请设置 ALLOW_ENGINEER_SELF_VERIFY=true');
    }
    const user = await requireUser(req);
    const now = nowIso();
    await query(`UPDATE users SET role = 'ENGINEER', updatedAt = ? WHERE id = ?`, [now, user.id]);
    const has = await queryOne(`SELECT userId FROM engineer_profiles WHERE userId = ?`, [user.id]);
    if (!has) {
      await query(
        `INSERT INTO engineer_profiles(userId, specialties, softwares, verifyStatus)
         VALUES(?, ?, ?, 'APPROVED')`,
        [user.id, JSON.stringify(['结构分析']), JSON.stringify(['ANSYS全系列'])]
      );
    } else {
      await query(`UPDATE engineer_profiles SET verifyStatus = 'APPROVED' WHERE userId = ?`, [user.id]);
    }
    await query(
      `INSERT INTO identity_verifications(userId, phone, verifyStatus, reviewedAt, updatedAt)
       VALUES(?, ?, 'APPROVED', ?, ?)
       ON DUPLICATE KEY UPDATE verifyStatus='APPROVED', reviewReason=NULL,
         reviewedAt=VALUES(reviewedAt), updatedAt=VALUES(updatedAt)`,
      [user.id, user.phone || null, now, now]);
    ok(res, await loadUserView(user.id));
  });

  // POST /api/auth/bind-phone { code }
  // 微信授权获取手机号：前端 button open-type="getPhoneNumber" → e.detail.code → 这里换号
  router.post('/api/auth/bind-phone', async (req, res) => {
    const user = await requireUser(req);
    const body = await readJson(req);
    const code = v.str(body.code, '手机号授权code', { min: 1 });
    let phoneNumber = null;
    try {
      phoneNumber = await exchangeWechatPhone(code);
    } catch (e) {
      // 本地开发降级：直接用传入的手机号（仅 dev）
      if (process.env.NODE_ENV === 'development' && body.phone) {
        phoneNumber = body.phone;
      } else {
        throw err.bad('获取手机号失败: ' + e.message);
      }
    }
    if (!phoneNumber) throw err.bad('未获取到手机号');

    // 检查手机号是否被其他用户占用
    const existing = await queryOne(`SELECT id FROM users WHERE phone = ? AND id != ? AND deletedAt IS NULL`, [phoneNumber, user.id]);
    if (existing) throw err.conflict('该手机号已被其他账号绑定');

    const boundAt = nowIso();
    await tx(async (conn) => {
      await conn.execute(`UPDATE users SET phone = ?, updatedAt = ? WHERE id = ?`, [phoneNumber, boundAt, user.id]);
      await conn.execute(
        `UPDATE identity_verifications
            SET phone = ?, updatedAt = ?
          WHERE userId = ?`,
        [phoneNumber, boundAt, user.id]
      );
    });
    ok(res, { phoneMasked: maskPhone(phoneNumber), user: await loadUserView(user.id) });
  });
}

module.exports = { register, loadUserView };
