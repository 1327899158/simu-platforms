'use strict';
async function migrate(query) {
  for (const table of ['payments', 'order_exposures']) {
    for (const [name,definition] of [['provider',"VARCHAR(16) NOT NULL DEFAULT 'cloudbase'"],['payMchid','VARCHAR(32) NULL'],['payAppid','VARCHAR(32) NULL']]) {
      const columns = await query(`SHOW COLUMNS FROM ${table} LIKE '${name}'`);
      if (!columns.length) {
        try { await query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`); }
        catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
      }
    }
  }
  await query(`CREATE TABLE IF NOT EXISTS payment_refunds (
    id VARCHAR(32) PRIMARY KEY, businessKey VARCHAR(80) NOT NULL UNIQUE,
    orderId VARCHAR(32) NOT NULL, paymentId VARCHAR(32) NOT NULL,
    outTradeNo VARCHAR(32) NOT NULL, outRefundNo VARCHAR(32) NOT NULL UNIQUE,
    sourceType VARCHAR(16) NOT NULL, sourceId VARCHAR(32) NOT NULL,
    grossRefundFen BIGINT NOT NULL, cashRefundFen BIGINT NOT NULL, coinRefund BIGINT NOT NULL,
    totalCashFen BIGINT NOT NULL, transactionId VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING', refundId VARCHAR(64),
    lastError VARCHAR(255), createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX(orderId), INDEX(status,updatedAt)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}
module.exports = { migrate };
