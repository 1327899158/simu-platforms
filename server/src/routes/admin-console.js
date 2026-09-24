'use strict';
const { query, queryOne, tx } = require('../db');
const { ok, err, readJson } = require('../lib/http');
const { requireAdmin, writeAdminAudit, ROLE_PERMISSIONS } = require('../lib/admin-mw');
const { newId, nowIso, v } = require('../lib/util');
const { config } = require('../config');
const { settings, validateSettings } = require('../services/admin-console');
const ROLES = { SUPER_ADMIN: '超级管理员', OPERATOR: '运营管理员', AUDITOR: '审计员', ENGINEER_REVIEWER: '认证审核员', ARBITER: '仲裁与客服管理员', FINANCE: '财务管理员' };
const PERMISSION_TEXT = { '*':'全部管理权限', DASHBOARD_READ:'查看工作台与统计', USER_READ:'查看用户', USER_STATUS_UPDATE:'管理用户状态', ENGINEER_READ:'查看认证资料', ENGINEER_APPROVE:'审核工程师资料', IDENTITY_APPROVE:'审核身份与企业机构认证', ORDER_READ:'查看订单', ORDER_FORCE_CLOSE:'关闭订单', AUDIT_READ:'查看操作日志', DISPUTE_READ:'查看纠纷', DISPUTE_RESOLVE:'裁决纠纷', INVOICE_READ:'查看发票申请', INVOICE_PROCESS:'交付发票', FINANCE_READ:'查看财务汇总', WALLET_MANAGE:'管理模拟钱包', CUSTOMER_SERVICE:'客服与工单', SUPPORT_MANAGE:'处理举报反馈', CAMPAIGN_MANAGE:'活动管理', ANNOUNCEMENT_MANAGE:'公告管理', HELP_MANAGE:'帮助内容管理' };
const today = 'DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR)), INTERVAL 8 HOUR)';
const page = q => ({ limit: 30, offset: q.get('offset') ? v.int(q.get('offset'), 'offset', { min: 0, max: 1000000 }) : 0 });
function register(router) {
  require('./admin-finance').register(router);
  router.get('/api/admin/console/operations', async (req,res,_p,q) => {
    const {admin}=await requireAdmin(req,'DASHBOARD_READ');
    const {hasPermission}=require('../lib/admin-mw');
    const permissions={orders:hasPermission(admin,'ORDER_READ')};
    return ok(res,await require('../services/operations-analytics').overview(Number(q.get('days')||30),permissions));
  });
  router.post('/api/admin/console/operations/plans', async (req,res) => {
    const {admin}=await requireAdmin(req,'CONFIG_MANAGE');const b=await readJson(req);
    const title=v.str(b.title,'措施名称',{min:2,max:100});
    const goal=v.str(b.goal,'目标与衡量指标',{min:2,max:500});
    const startDate=v.str(b.startDate,'执行日期',{min:10,max:10});
    if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||!Number.isFinite(Date.parse(startDate+'T00:00:00Z'))||new Date(startDate+'T00:00:00Z').toISOString().slice(0,10)!==startDate)throw err.bad('执行日期无效');
    const item={id:newId(),title,goal,startDate,createdAt:nowIso(),owner:admin.displayName||'管理员'};
    await tx(async c=>{
      await c.execute("INSERT IGNORE INTO admin_console_settings(settingKey,valueJson,updatedAt) VALUES('operationsPlans','[]',?)",[nowIso()]);
      const [[stored]]=await c.execute("SELECT valueJson FROM admin_console_settings WHERE settingKey='operationsPlans' FOR UPDATE");
      const plans=require('../db').parseJson(stored.valueJson,[]);
      if(!Array.isArray(plans))throw err.conflict('措施记录格式异常');
      if(plans.length>=100)throw err.conflict('最多记录100项措施，请先联系管理员归档');
      plans.unshift(item);
      await c.execute("UPDATE admin_console_settings SET valueJson=?,updatedAt=? WHERE settingKey='operationsPlans'",[JSON.stringify(plans),nowIso()]);
      await writeAdminAudit(req,admin,'OPERATIONS_PLAN_CREATE','SETTINGS',item.id,item,c);
    });
    ok(res,item);
  });
  router.get('/api/admin/console/overview', async (req, res) => {
    await requireAdmin(req, 'DASHBOARD_READ');
    const [orders, payments, engineers, disputes] = await Promise.all([
      queryOne(`SELECT COUNT(*) n FROM orders WHERE deletedAt IS NULL AND createdAt>=${today}`),
      queryOne(`SELECT COALESCE(SUM(amountFen),0) n FROM payments WHERE status='SUCCESS' AND paidAt>=${today}`),
      queryOne("SELECT COUNT(DISTINCT engineerId) n FROM quotes WHERE createdAt >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 7 DAY)"),
      queryOne("SELECT COUNT(*) n, SUM(status='RESOLVED') resolved FROM disputes WHERE status<>'CANCELLED'")
    ]);
    return ok(res, { todayOrders: Number(orders.n), todayPaidFen: Number(payments.n), quotingEngineers7d: Number(engineers.n),
      disputeResolutionRate: Number(disputes.n) ? Math.round(Number(disputes.resolved) / Number(disputes.n) * 100) : null, paymentMode: config.paymentMode });
  });
  router.get('/api/admin/console/finance', async (req, res, _p, q) => {
    await requireAdmin(req, 'FINANCE_READ');
    const days = q.get('days') ? v.int(q.get('days'), 'days', { min: 1, max: 365 }) : 30;
    const [payments, refunds, wallet, withdrawals, invoices, daily] = await Promise.all([
      queryOne(`SELECT COUNT(*) count, COALESCE(SUM(amountFen),0) amountFen FROM payments WHERE status='SUCCESS' AND paidAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY)`),
      query("SELECT refundStatus status, COUNT(*) count, COALESCE(SUM(refundAmountFen),0) amountFen FROM disputes WHERE refundAmountFen>0 GROUP BY refundStatus"),
      queryOne('SELECT COALESCE(SUM(availableFen),0) availableFen, COALESCE(SUM(frozenFen),0) frozenFen FROM demo_wallets'),
      query("SELECT status,COUNT(*) count,COALESCE(SUM(amountFen),0) amountFen FROM demo_withdrawals GROUP BY status"),
      query('SELECT status,COUNT(*) count FROM invoice_requests GROUP BY status'),
      query(`SELECT DATE_FORMAT(DATE_ADD(paidAt,INTERVAL 8 HOUR),'%Y-%m-%d') day, COUNT(*) count, SUM(amountFen) amountFen FROM payments WHERE status='SUCCESS' AND paidAt>=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL ${days} DAY) GROUP BY day ORDER BY day DESC`)
    ]);
    return ok(res, { days, paymentMode: config.paymentMode, payments, refunds, wallet, withdrawals, invoices, daily,
      notice: '成功支付记录不等于平台收入；可能包含历史模拟支付。退款按纠纷记录列示。钱包、提现均为模拟数据，未接入真实分账、打款或税务开票。' });
  });
  router.get('/api/admin/console/hall', async (req, res) => {
    await requireAdmin(req, 'DASHBOARD_READ');
    const publicOrders = "o.deletedAt IS NULL AND NOT EXISTS(SELECT 1 FROM direct_demands dd WHERE dd.orderId COLLATE utf8mb4_unicode_ci=o.id COLLATE utf8mb4_unicode_ci)";
    const [summary, top, levels] = await Promise.all([
      queryOne(`SELECT COUNT(*) total,SUM(o.status='QUOTING') quoting,COALESCE(SUM(o.viewCount),0) views,SUM(o.budgetFen>=500000 AND o.status='QUOTING') highBudget FROM orders o WHERE ${publicOrders}`),
      query(`SELECT o.id,o.orderNo,o.projectName,o.viewCount,o.budgetFen,(SELECT COUNT(*) FROM quotes q WHERE q.orderId=o.id AND q.status<>'WITHDRAWN') quoteCount FROM orders o WHERE ${publicOrders} AND o.status='QUOTING' ORDER BY o.viewCount DESC,o.createdAt DESC LIMIT 20`),
      query('SELECT role,COUNT(*) count FROM users WHERE deletedAt IS NULL AND status=\'ACTIVE\' GROUP BY role')
    ]);
    return ok(res, { summary, top, users: levels, settings: await settings(), analytics: await require('../services/hall-analytics').analytics() });
  });
  router.get('/api/admin/console/storage', async (req, res, _p, q) => {
    await requireAdmin(req, 'STORAGE_READ');
    const { limit, offset } = page(q);
    const [summary, groups, items] = await Promise.all([
      queryOne('SELECT COUNT(*) count,COALESCE(SUM(IF(netdiskUrl IS NULL,sizeBytes,0)),0) bytes,SUM(netdiskUrl IS NOT NULL) links FROM uploaded_files'),
      query('SELECT kind,COUNT(*) count,COALESCE(SUM(IF(netdiskUrl IS NULL,sizeBytes,0)),0) bytes FROM uploaded_files GROUP BY kind'),
      query(`SELECT id,name,kind,sizeBytes,createdAt,(netdiskUrl IS NOT NULL) isLink FROM uploaded_files ORDER BY createdAt DESC,id DESC LIMIT ${limit} OFFSET ${offset}`)
    ]);
    return ok(res, { summary, groups, items, offset, hasMore: offset + items.length < Number(summary.count), notice: '仅统计业务登记文件，非存储桶实时用量。未启用自动删除；认证、纠纷证据等材料不会在这里被删除。' });
  });
  router.get('/api/admin/console/config', async (req, res) => {
    await requireAdmin(req, 'CONFIG_MANAGE');
    return ok(res, { settings: await settings(), levels: require('../services/engineer-level').LEVELS,
      paymentMode: config.paymentMode, uploadMaxMb: config.uploadMaxMb,
      notice: '当前可调整大厅热门排序的报价权重，保存后新请求生效。工程师等级由实际履约统计计算；认证工程师只要求身份认证通过。资金、收货期限和信用规则不在此处修改。' });
  });
  router.patch('/api/admin/console/config', async (req, res) => {
    const { admin } = await requireAdmin(req, 'CONFIG_MANAGE');
    const value = validateSettings(await readJson(req));
    await tx(async c => {
      await c.execute("INSERT INTO admin_console_settings(settingKey,valueJson,updatedAt) VALUES('hall',?,?) ON DUPLICATE KEY UPDATE valueJson=VALUES(valueJson),updatedAt=VALUES(updatedAt)", [JSON.stringify(value), nowIso()]);
      await writeAdminAudit(req, admin, 'CONSOLE_CONFIG_UPDATE', 'SETTINGS', 'hall', value, c);
    });
    return ok(res, value);
  });
  router.get('/api/admin/console/marketing', async (req, res) => {
    await requireAdmin(req, 'CAMPAIGN_MANAGE');
    const coupons = await query('SELECT offerKey,title,status,COUNT(*) count,SUM(amountFen) amountFen FROM user_coupons GROUP BY offerKey,title,status');
    return ok(res, { coupons, notice: '优惠券为预留权益，尚未接入支付抵扣。活动内容和展示状态可在首页活动管理中维护。' });
  });
  router.get('/api/admin/console/appeals', async (req, res, _p, q) => {
    await requireAdmin(req, 'DISPUTE_READ');
    const { limit, offset } = page(q);
    const where = 'r.disputeId IS NOT NULL';
    const [count, items] = await Promise.all([
      queryOne(`SELECT COUNT(*) count FROM refund_requests r WHERE ${where}`),
      query(`SELECT r.id,r.disputeId,r.status,r.reason,r.createdAt,o.orderNo,o.projectName,d.status disputeStatus FROM refund_requests r JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci=r.orderId COLLATE utf8mb4_unicode_ci LEFT JOIN disputes d ON d.id COLLATE utf8mb4_unicode_ci=r.disputeId COLLATE utf8mb4_unicode_ci WHERE ${where} ORDER BY r.createdAt DESC,r.id DESC LIMIT ${limit} OFFSET ${offset}`)
    ]);
    return ok(res, { items, hasMore: offset + items.length < Number(count.count), notice: '这里展示已转入纠纷处理的退款申请。点击进入仲裁；自动信用扣分申诉机制尚未接入。' });
  });
  router.get('/api/admin/console/accounts', async (req, res, _p, q) => {
    await requireAdmin(req, 'ADMIN_MANAGE');
    const { limit, offset } = page(q);
    const [count, items] = await Promise.all([queryOne('SELECT COUNT(*) count FROM admin_accounts'), query(`SELECT id,userId,displayName,adminRole,status,lastLoginAt FROM admin_accounts ORDER BY createdAt DESC,id DESC LIMIT ${limit} OFFSET ${offset}`)]);
    return ok(res, { items, hasMore: offset + items.length < Number(count.count), roles: Object.entries(ROLES).map(([key,label]) => ({ key,label,permissions: ROLE_PERMISSIONS[key], permissionLabels: ROLE_PERMISSIONS[key].map(p => PERMISSION_TEXT[p] || p) })) });
  });
  router.post('/api/admin/console/accounts', async (req, res) => {
    const { admin } = await requireAdmin(req, 'ADMIN_MANAGE');
    const body = await readJson(req);
    const userId = v.str(body.userId, '用户ID', { min: 1, max: 32 });
    const displayName = v.str(body.displayName, '管理员名称', { min: 1, max: 100 });
    if (!Object.hasOwn(ROLES, body.adminRole) || !['ACTIVE', 'DISABLED'].includes(body.status)) throw err.bad('无效的角色或账号状态');
    if (userId === admin.userId) throw err.bad('不能在此修改自己的管理员权限');
    await tx(async c => {
      // Serialize account changes, including the last-super-admin invariant.
      const [accounts] = await c.execute('SELECT id,userId,adminRole,status FROM admin_accounts ORDER BY id FOR UPDATE');
      const actor = accounts.find(a => a.id === admin.id);
      if (!actor || actor.status !== 'ACTIVE' || actor.adminRole !== 'SUPER_ADMIN') throw err.forbidden('管理员权限已变更，请重新登录');
      const [users] = await c.execute('SELECT id,openid,status FROM users WHERE id=? AND deletedAt IS NULL FOR UPDATE', [userId]);
      const user = users[0];
      if (!user || user.status !== 'ACTIVE') throw err.bad('请先在用户管理中确认有效的已注册用户ID');
      if (config.adminBootstrapUserIds.includes(userId) || (user.openid && config.adminBootstrapOpenids.includes(user.openid))) throw err.bad('此账号由部署配置管理，请修改部署配置');
      const existing = accounts.find(a => a.userId === userId);
      if (existing?.adminRole === 'SUPER_ADMIN' && existing.status === 'ACTIVE' &&
          (body.adminRole !== 'SUPER_ADMIN' || body.status !== 'ACTIVE') &&
          accounts.filter(a => a.adminRole === 'SUPER_ADMIN' && a.status === 'ACTIVE').length <= 1) throw err.bad('必须保留一个有效超级管理员');
      const id = existing?.id || newId(), now = nowIso();
      if (existing) await c.execute('UPDATE admin_accounts SET adminRole=?,status=?,displayName=?,updatedAt=? WHERE id=?', [body.adminRole, body.status, displayName, now, id]);
      else await c.execute('INSERT INTO admin_accounts(id,userId,openid,adminRole,status,displayName,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?)', [id,userId,user.openid || null,body.adminRole,body.status,displayName,now,now]);
      await writeAdminAudit(req, admin, 'ADMIN_ACCOUNT_UPDATE', 'ADMIN', id, { userId, before: existing || null, role: body.adminRole, status: body.status }, c);
    });
    return ok(res, { saved: true });
  });
}
module.exports = { register, ROLES };
