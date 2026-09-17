'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRouter } = require('../src/lib/http');
let user, identityPhone, codes, occupied, failIdentity, allowed;
const mock = (name, exports) => { require.cache[require.resolve(name)] = { exports, loaded: true }; };
function reset() {
  user = { id: 'u', username: '123456', phone: '13800000000', status: 'ACTIVE', sessionToken: 'old-session' };
  identityPhone = user.phone; occupied = false; failIdentity = false; allowed = true;
  codes = [
    { id: 'old', phone: user.phone, code: '123456', type: 'CHANGE_OLD', expiresAt: new Date(Date.now() + 600000) },
    { id: 'new', phone: '13900000000', code: '654321', type: 'CHANGE_NEW', expiresAt: new Date(Date.now() + 600000) },
  ];
}
async function execute(sql, p) {
  if (sql.startsWith('SELECT * FROM users')) return [[{ ...user }]];
  if (sql.startsWith('SELECT id FROM users')) return [occupied ? [{ id: 'other' }] : []];
  if (sql.startsWith('SELECT id, expiresAt')) return [codes.filter(c => c.phone === p[0] && c.code === p[1] && c.type === p[2])];
  if (sql.startsWith('UPDATE sms_codes')) {
    const matches = codes.filter(c => !c.usedAt && (sql.includes('WHERE id =') ? c.id === p[1] && c.expiresAt > new Date() : c.phone === p[1]));
    matches.forEach(c => { c.usedAt = p[0]; });
    return [{ affectedRows: matches.length }];
  }
  if (sql.startsWith('UPDATE users SET phoneChangeToken')) {
    user.phoneChangeToken = p[0]; user.phoneChangeExpiresAt = new Date(Date.now() + 600000); return [{}];
  }
  if (sql.startsWith('UPDATE users SET phone =')) {
    user.phone = p[0]; user.phoneChangedAt = new Date(); user.phoneChangeToken = null;
    user.phoneChangeExpiresAt = null; user.sessionToken = null; return [{}];
  }
  if (sql.startsWith('UPDATE identity_verifications')) {
    if (failIdentity) throw Error('write failed');
    identityPhone = p[0]; return [{}];
  }
  throw Error('Unexpected SQL: ' + sql);
}
mock('../src/db', {
  queryOne: async (sql, p) => (await execute(sql, p))[0][0],
  query: async (sql, p) => (await execute(sql, p))[0],
  tx: async fn => {
    const snapshot = structuredClone({ user, identityPhone, codes });
    try { return await fn({ execute }); }
    catch (e) { ({ user, identityPhone, codes } = snapshot); throw e; }
  },
});
mock('../src/services/auth-rate-svc', { getClientIp: () => 'ip', consumeWindow: async () => ({ allowed }) });
const router = createRouter();
const { register, eligible } = require('../src/routes/phone-change');
register(router);
async function call(action, body = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify({ username: '123456', ...body }))]);
  let data;
  await router.match('POST', '/api/auth/phone-change/' + action).handler(req, {
    writeHead() {}, end(raw) { data = JSON.parse(raw).data; },
  });
  return data;
}
async function verify() { return (await call('verify-old', { smsCode: '123456' })).token; }
function confirm(token) { return call('confirm', { token, phone: '13900000000', smsCode: '654321' }); }

test('原手机验证后才可换绑，同时更新资料、注销旧会话并阻止重复提交', async () => {
  reset();
  await assert.rejects(confirm('a'.repeat(64)), /原手机号验证已失效/);
  await assert.rejects(call('verify-old', { smsCode: '000000' }), /验证码不存在/);
  const token = await verify();
  assert.notEqual(user.phoneChangeToken, token);
  await assert.rejects(verify(), /验证码已被使用/);
  await confirm(token);
  assert.equal(user.phone, '13900000000'); assert.equal(identityPhone, user.phone);
  assert.equal(user.sessionToken, null); assert.equal(user.phoneChangeToken, null);
  assert.ok(codes.every(c => c.usedAt));
  await assert.rejects(confirm(token), /30天/);
});
test('号码占用或资料写入失败时回滚，验证码可重试', async () => {
  reset(); const token = await verify();
  occupied = true;
  await assert.rejects(confirm(token), /其他账号/);
  occupied = false; failIdentity = true;
  await assert.rejects(confirm(token), /write failed/);
  assert.equal(user.phone, '13800000000'); assert.equal(identityPhone, user.phone);
  assert.equal(codes[1].usedAt, undefined); assert.ok(user.phoneChangeToken);
  failIdentity = false; await confirm(token);
});
test('过期凭证、过期新手机验证码、停用账号及限流均拦截', async () => {
  reset(); const token = await verify();
  user.phoneChangeExpiresAt = new Date(Date.now() - 1);
  await assert.rejects(confirm(token), /验证已失效/);
  user.phoneChangeExpiresAt = new Date(Date.now() + 60000);
  codes[1].expiresAt = new Date(Date.now() - 1);
  await assert.rejects(confirm(token), /验证码已过期/);
  user.status = 'BANNED'; await assert.rejects(confirm(token), /账号不可用/);
  user.status = 'ACTIVE'; allowed = false;
  await assert.rejects(confirm(token), /操作过于频繁/);
});
test('30天限制边界，原密码重置验证码不能用于换绑', async () => {
  reset(); user.phoneChangedAt = new Date(Date.now() - 29 * 86400000);
  assert.throws(() => eligible(user), /30天/);
  user.phoneChangedAt = new Date(Date.now() - 30 * 86400000);
  assert.doesNotThrow(() => eligible(user));
  codes[0].type = 'RESET_PWD';
  await assert.rejects(verify(), /验证码不存在/);
});

test('换绑页面分步验证，成功清理缓存并返回登录页', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  let page, navigated, fail = false;
  const removed = [], calls = [];
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniapp/pages/change-phone/index.js'), 'utf8'), {
    Page: p => { page = p; }, clearInterval() {}, setInterval() {},
    wx: { showToast() {}, removeStorageSync: key => removed.push(key),
      showModal: options => options.success(), reLaunch: options => { navigated = options.url; } },
    require: name => name.endsWith('/request') ? { request: async (method, url, body) => {
      calls.push({ url, body });
      if (fail) throw Error('network failed');
      return { token: 'verified-grant' };
    } } : name.endsWith('/auth') ? { getPasswordResetTarget: async () => ({ phoneMasked: '138****0000' }) } : { digits: value => value },
  });
  page.setData = patch => Object.assign(page.data, patch);
  await page.onLoad({ username: '123456' });
  page.data.smsCode = '123456'; fail = true;
  await page.submit(); assert.equal(page.data.step, 1);
  fail = false; await page.submit(); assert.equal(page.data.step, 2);
  assert.equal(page.data.smsCode, ''); assert.equal(page.token, 'verified-grant');
  page.data.phone = '13900000000'; page.data.smsCode = '654321';
  fail = true; await page.submit(); assert.equal(removed.length, 0);
  fail = false; await page.submit();
  assert.equal(calls.at(-1).body.token, 'verified-grant');
  assert.deepEqual(removed, ['user', 'sessionToken']);
  assert.equal(navigated, '/pages/login/index'); assert.equal(page.data.ready, false);
});
