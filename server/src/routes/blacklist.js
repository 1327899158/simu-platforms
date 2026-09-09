'use strict';
const { requireUser } = require('../lib/auth-mw');
const { ok, err } = require('../lib/http');
const svc = require('../services/blacklist-svc');
async function actor(req) {
  const u = await requireUser(req);
  if (!['CUSTOMER','ENGINEER'].includes(u.role)) throw err.forbidden('仅客户和工程师可管理黑名单');
  return u;
}
function register(router) {
  router.get('/api/blacklist', async(req,res,p,q) => ok(res,await svc.list((await actor(req)).id,q.get('offset') || 0)));
  router.post('/api/blacklist/:id', async(req,res,p) => ok(res,await svc.add((await actor(req)).id,p.id)));
  router.del('/api/blacklist/:id', async(req,res,p) => ok(res,await svc.remove((await actor(req)).id,p.id)));
}
module.exports = { register };
