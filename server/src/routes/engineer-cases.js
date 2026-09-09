'use strict';
const { requireUser, requireEngineer } = require('../lib/auth-mw');
const { ok, err, readJson } = require('../lib/http');
const svc = require('../services/engineer-case-svc');
async function owner(req) {
  const u = await requireUser(req);
  if (u.role !== 'ENGINEER') throw err.forbidden('仅工程师可管理案例');
  return u;
}
function register(router) {
  router.get('/api/engineers/me/cases', async (req, res) => ok(res, await svc.ownCases((await owner(req)).id)));
  router.get('/api/engineers/me/case-candidates', async (req, res, _p, q) => ok(res, await svc.candidates((await owner(req)).id, q.get('offset') || 0)));
  router.post('/api/engineers/me/cases', async (req, res) => ok(res, await svc.saveCase((await requireEngineer(req)).id, await readJson(req))));
  router.patch('/api/engineers/me/cases/:id', async (req, res, p) => ok(res, await svc.saveCase((await requireEngineer(req)).id, await readJson(req), p.id)));
  // 即使认证失效，仍允许工程师移除自己的公开资料。
  router.del('/api/engineers/me/cases/:id', async (req, res, p) => ok(res, await svc.removeCase((await owner(req)).id, p.id)));
  router.get('/api/engineers/:id/cases', async (req, res, p, q) => { await requireUser(req); ok(res, await svc.publicCases(p.id, q.get('offset') || 0)); });
}
module.exports = { register };
