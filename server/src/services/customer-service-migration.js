'use strict';
async function migrate(query){
 for(const sql of [
  `CREATE TABLE IF NOT EXISTS feature_activation (feature VARCHAR(64) PRIMARY KEY, activatedAt DATETIME(3) NOT NULL)`,
  `INSERT IGNORE INTO feature_activation(feature,activatedAt) VALUES('ORDER_COMPLETE_500',UTC_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS service_tickets (id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,category VARCHAR(32) NOT NULL,title VARCHAR(120) NOT NULL,content TEXT NOT NULL,evidence JSON NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'OPEN',assignedAdminId VARCHAR(32),createdAt DATETIME(3) NOT NULL,updatedAt DATETIME(3) NOT NULL,INDEX(userId,updatedAt),INDEX(status,updatedAt))`,
  `CREATE TABLE IF NOT EXISTS service_ticket_messages (id BIGINT AUTO_INCREMENT PRIMARY KEY,ticketId VARCHAR(32) NOT NULL,senderId VARCHAR(32) NOT NULL,senderKind VARCHAR(12) NOT NULL,content TEXT NOT NULL,createdAt DATETIME(3) NOT NULL,INDEX(ticketId,id))`,
  `CREATE TABLE IF NOT EXISTS announcements (id VARCHAR(32) PRIMARY KEY,title VARCHAR(80) NOT NULL,content TEXT NOT NULL,targetRole VARCHAR(16) NOT NULL,startsAt DATETIME(3) NOT NULL,endsAt DATETIME(3) NOT NULL,enabled TINYINT NOT NULL,revision INT NOT NULL DEFAULT 1,updatedAt DATETIME(3) NOT NULL,INDEX(enabled,startsAt,endsAt))`,
 ])await query(sql);
 const channel=await query("SHOW COLUMNS FROM service_tickets LIKE 'channel'");
 if(!channel.length){try{await query("ALTER TABLE service_tickets ADD COLUMN channel VARCHAR(12) NOT NULL DEFAULT 'TICKET'");}catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}}
 const columns=await query("SHOW COLUMNS FROM service_tickets LIKE 'relatedOrder'");
 if(!columns.length){
  try{await query('ALTER TABLE service_tickets ADD COLUMN relatedOrder JSON NULL');}
  catch(e){if(e.code!=='ER_DUP_FIELDNAME')throw e;}
 }
}
module.exports={migrate};
