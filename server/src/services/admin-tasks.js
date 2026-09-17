'use strict';
const { queryOne } = require('../db');
const { hasPermission } = require('../lib/admin-mw');
const tasks = [
  ['customer-service', 'CUSTOMER_SERVICE', "SELECT COUNT(*) n FROM service_tickets WHERE status IN ('OPEN','PROCESSING')"],
  ['enterprise', 'IDENTITY_APPROVE', "SELECT COUNT(*) n FROM enterprise_certifications WHERE status='PENDING'"],
  ['wallet', 'WALLET_MANAGE', "SELECT COUNT(*) n FROM demo_withdrawals WHERE status IN ('SUBMITTED','APPROVED','PAYING')"],
  ['support', 'SUPPORT_MANAGE', "SELECT COUNT(*) n FROM support_submissions WHERE status IN ('SUBMITTED','ACCEPTED','INVESTIGATING')"],
  ['invoices', 'INVOICE_READ', "SELECT COUNT(*) n FROM invoice_requests WHERE status='PLATFORM_REQUESTED'"],
  ['disputes', 'DISPUTE_READ', "SELECT COUNT(*) n FROM disputes WHERE status='OPEN'"],
];
async function pendingTasks(admin) {
  const entries = await Promise.all(tasks.filter(([,permission]) => hasPermission(admin, permission)).map(async ([key,,sql]) => [key, Number((await queryOne(sql)).n || 0)]));
  return Object.fromEntries(entries);
}
module.exports = { pendingTasks };
