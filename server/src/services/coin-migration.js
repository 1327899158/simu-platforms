'use strict';
async function migrate(query) {
 for(const sql of [
  `CREATE TABLE IF NOT EXISTS coin_spends (businessKey VARCHAR(100) PRIMARY KEY,userId VARCHAR(32) NOT NULL,kind VARCHAR(16) NOT NULL,orderId VARCHAR(32) NOT NULL,coins BIGINT NOT NULL,refundedCoins BIGINT NOT NULL DEFAULT 0,status VARCHAR(16) NOT NULL DEFAULT 'HELD',createdAt DATETIME(3) NOT NULL,updatedAt DATETIME(3) NOT NULL,INDEX(userId,status),INDEX(kind,orderId))`,
  `CREATE TABLE IF NOT EXISTS coin_refunds (businessKey VARCHAR(100) PRIMARY KEY,paymentKey VARCHAR(100) NOT NULL,userId VARCHAR(32) NOT NULL,coins BIGINT NOT NULL,createdAt DATETIME(3) NOT NULL,INDEX(userId,createdAt))`,
  `CREATE TABLE IF NOT EXISTS invitation_codes (userId VARCHAR(32) PRIMARY KEY,code CHAR(16) NOT NULL UNIQUE,qrBase64 MEDIUMTEXT,urlLink VARCHAR(1000),urlExpiresAt DATETIME(3),updatedAt DATETIME(3) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS invitation_relations (inviteeId VARCHAR(32) PRIMARY KEY,inviterId VARCHAR(32) NOT NULL,code CHAR(16) NOT NULL,firstOrderId VARCHAR(32),firstRewardAt DATETIME(3),createdAt DATETIME(3) NOT NULL,INDEX(inviterId,createdAt))`
 ])await query(sql+' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
 for(const [table,cols] of [['payments',{grossAmountFen:'BIGINT NULL',coinAmount:'BIGINT NOT NULL DEFAULT 0'}],['order_exposures',{cashAmountFen:'BIGINT NULL',coinAmount:'BIGINT NOT NULL DEFAULT 0'}],['invitation_codes',{linkEnvVersion:'VARCHAR(12) NULL'}]]){
  for(const [col,type] of Object.entries(cols))if(!(await query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`)).length){try{await query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}}
 }
 const period=(await query("SHOW COLUMNS FROM incentive_rewards LIKE 'periodKey'"))[0];
 const size=period&&/^varchar\((\d+)\)/i.exec(period.Type);
 if(size&&Number(size[1])<64)await query('ALTER TABLE incentive_rewards MODIFY periodKey VARCHAR(64) NOT NULL');
}
module.exports={migrate};
