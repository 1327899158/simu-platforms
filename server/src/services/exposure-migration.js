'use strict';
async function migrate(query) {
  await query(`CREATE TABLE IF NOT EXISTS order_exposures (
    orderId VARCHAR(32) PRIMARY KEY, customerId VARCHAR(32) NOT NULL,
    targetPeople INT NOT NULL, deliveredPeople INT NOT NULL DEFAULT 0,
    amountFen INT NOT NULL, paymentStatus VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    outTradeNo VARCHAR(32) NOT NULL UNIQUE, transactionId VARCHAR(64), paymentMode VARCHAR(16),
    paymentStartedAt DATETIME(3), paidAt DATETIME(3), createdAt DATETIME(3) NOT NULL,
    INDEX(customerId), INDEX(paymentStatus, deliveredPeople)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await query(`CREATE TABLE IF NOT EXISTS exposure_deliveries (
    orderId VARCHAR(32) NOT NULL, engineerId VARCHAR(32) NOT NULL,
    token VARCHAR(32) NOT NULL, expiresAt DATETIME(3) NOT NULL, seenAt DATETIME(3),
    PRIMARY KEY(orderId,engineerId)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  // 历史加急不再影响排序；原曝光没有实际收费，不能自动视为已购买。
  await query("UPDATE orders SET promotion='NONE' WHERE promotion='URGENT'");
}
module.exports = { migrate };
