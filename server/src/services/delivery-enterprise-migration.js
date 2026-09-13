'use strict';
async function migrate(query) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS order_delivery_terms (orderId VARCHAR(32) PRIMARY KEY, deadline DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS delivery_extensions (id VARCHAR(32) PRIMARY KEY, orderId VARCHAR(32) NOT NULL, engineerId VARCHAR(32) NOT NULL, days INT NOT NULL, reason VARCHAR(1000) NOT NULL, status VARCHAR(20) NOT NULL, oldDeadline DATETIME(3) NOT NULL, proposedDeadline DATETIME(3) NOT NULL, createdAt DATETIME(3) NOT NULL, respondedAt DATETIME(3), INDEX(orderId,createdAt))`,
    `CREATE TABLE IF NOT EXISTS enterprise_certifications (userId VARCHAR(32) PRIMARY KEY, companyName VARCHAR(120) NOT NULL, creditCode VARCHAR(18) NOT NULL UNIQUE, evidence JSON NOT NULL, status VARCHAR(20) NOT NULL, result VARCHAR(1000), revision INT NOT NULL DEFAULT 1, submittedAt DATETIME(3) NOT NULL, reviewedAt DATETIME(3))`,
    `CREATE TABLE IF NOT EXISTS enterprise_documents (id VARCHAR(32) PRIMARY KEY, userId VARCHAR(32) NOT NULL, mime VARCHAR(30) NOT NULL, payload MEDIUMTEXT NOT NULL, createdAt DATETIME(3) NOT NULL, INDEX(userId))`,
  ]) await query(sql);
}
module.exports={migrate};
