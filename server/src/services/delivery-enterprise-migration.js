'use strict';
async function migrate(query) {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS enterprise_document_uploads (userId VARCHAR(32) NOT NULL, id VARCHAR(64) NOT NULL, total INT NOT NULL, nextIndex INT NOT NULL, payload MEDIUMTEXT NOT NULL, documentId VARCHAR(32), expiresAt DATETIME(3) NOT NULL, PRIMARY KEY(userId,id), INDEX(expiresAt)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS delivery_reminders (orderId VARCHAR(32) NOT NULL, deadline DATETIME(3) NOT NULL, kind VARCHAR(16) NOT NULL, createdAt DATETIME(3) NOT NULL, PRIMARY KEY(orderId,deadline,kind))`,
    `CREATE TABLE IF NOT EXISTS delivery_breaches (orderId VARCHAR(32) PRIMARY KEY, deadline DATETIME(3) NOT NULL, disputeId VARCHAR(32) NOT NULL UNIQUE, createdAt DATETIME(3) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS order_delivery_terms (orderId VARCHAR(32) PRIMARY KEY, deadline DATETIME(3) NOT NULL, updatedAt DATETIME(3) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS delivery_extensions (id VARCHAR(32) PRIMARY KEY, orderId VARCHAR(32) NOT NULL, engineerId VARCHAR(32) NOT NULL, days INT NOT NULL, reason VARCHAR(1000) NOT NULL, status VARCHAR(20) NOT NULL, oldDeadline DATETIME(3) NOT NULL, proposedDeadline DATETIME(3) NOT NULL, createdAt DATETIME(3) NOT NULL, respondedAt DATETIME(3), INDEX(orderId,createdAt))`,
    `CREATE TABLE IF NOT EXISTS enterprise_certifications (userId VARCHAR(32) PRIMARY KEY, companyName VARCHAR(120) NOT NULL, creditCode VARCHAR(18) NOT NULL UNIQUE, evidence JSON NOT NULL, status VARCHAR(20) NOT NULL, result VARCHAR(1000), revision INT NOT NULL DEFAULT 1, submittedAt DATETIME(3) NOT NULL, reviewedAt DATETIME(3))`,
    `CREATE TABLE IF NOT EXISTS enterprise_documents (id VARCHAR(32) PRIMARY KEY, userId VARCHAR(32) NOT NULL, mime VARCHAR(30) NOT NULL, payload MEDIUMTEXT NOT NULL, createdAt DATETIME(3) NOT NULL, INDEX(userId))`,
  ]) await query(sql);
  const columns = await query('SHOW COLUMNS FROM enterprise_certifications');
  for (const [name, definition] of [['certificationType',"VARCHAR(20) NOT NULL DEFAULT 'COMPANY'"],['applicationNote','VARCHAR(1000) NULL'],['displayLabel','VARCHAR(40) NULL']]) {
    if (!columns.some(c => c.Field === name)) await query(`ALTER TABLE enterprise_certifications ADD COLUMN ${name} ${definition}`);
  }
  if (columns.some(c => c.Field === 'creditCode' && c.Null === 'NO')) await query('ALTER TABLE enterprise_certifications MODIFY COLUMN creditCode VARCHAR(18) NULL');
}
module.exports={migrate};
