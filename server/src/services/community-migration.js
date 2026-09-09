'use strict';
const definitions = [
  `CREATE TABLE IF NOT EXISTS support_evidence_blobs (id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,mime VARCHAR(32) NOT NULL,payload MEDIUMTEXT NOT NULL,createdAt DATETIME(3) NOT NULL,INDEX idx_support_blob_owner(userId,createdAt))`,
  `CREATE TABLE IF NOT EXISTS user_favorites (userId VARCHAR(32) NOT NULL,kind VARCHAR(16) NOT NULL,targetId VARCHAR(32) NOT NULL,createdAt DATETIME(3) NOT NULL,PRIMARY KEY(userId,kind,targetId))`,
  `CREATE TABLE IF NOT EXISTS help_articles (id VARCHAR(32) PRIMARY KEY,kind VARCHAR(16) NOT NULL,title VARCHAR(120) NOT NULL,content TEXT NOT NULL,enabled TINYINT NOT NULL DEFAULT 1,sortOrder INT NOT NULL DEFAULT 0,updatedAt DATETIME(3) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_submissions (id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,kind VARCHAR(16) NOT NULL,targetId VARCHAR(32),category VARCHAR(60) NOT NULL,content TEXT NOT NULL,evidence JSON NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED',result TEXT,createdAt DATETIME(3) NOT NULL,updatedAt DATETIME(3) NOT NULL,INDEX idx_support_owner(userId,createdAt),INDEX idx_support_status(kind,status))`,
  `CREATE TABLE IF NOT EXISTS support_events (id VARCHAR(32) PRIMARY KEY,submissionId VARCHAR(32) NOT NULL,status VARCHAR(20) NOT NULL,note TEXT NOT NULL,adminId VARCHAR(32),createdAt DATETIME(3) NOT NULL,INDEX idx_support_events(submissionId,createdAt))`,
  `CREATE TABLE IF NOT EXISTS account_closures (userId VARCHAR(32) PRIMARY KEY,status VARCHAR(20) NOT NULL,requestedAt DATETIME(3) NOT NULL,executeAfter DATETIME(3) NOT NULL,completedAt DATETIME(3),lastError VARCHAR(500),updatedAt DATETIME(3) NOT NULL,INDEX idx_closure_due(status,executeAfter))`,
  `CREATE TABLE IF NOT EXISTS account_closure_events (id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,action VARCHAR(24) NOT NULL,createdAt DATETIME(3) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cooperation_settings (engineerId VARCHAR(32) PRIMARY KEY,enabled TINYINT NOT NULL DEFAULT 0,discountBps INT NOT NULL DEFAULT 10000,responseHours INT NOT NULL DEFAULT 24,scheduleNote VARCHAR(500) NOT NULL DEFAULT '',revisionCount INT NOT NULL DEFAULT 2,minAmountFen BIGINT NOT NULL DEFAULT 100,updatedAt DATETIME(3) NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS cooperation_relations (id VARCHAR(32) PRIMARY KEY,customerId VARCHAR(32) NOT NULL,engineerId VARCHAR(32) NOT NULL,status VARCHAR(20) NOT NULL,terms JSON NOT NULL,message VARCHAR(1000),createdAt DATETIME(3) NOT NULL,updatedAt DATETIME(3) NOT NULL,UNIQUE KEY uq_cooperation_pair(customerId,engineerId))`,
  `CREATE TABLE IF NOT EXISTS direct_demands (orderId VARCHAR(32) PRIMARY KEY,customerId VARCHAR(32) NOT NULL,engineerId VARCHAR(32) NOT NULL,relationId VARCHAR(32) NOT NULL,terms JSON NOT NULL,createdAt DATETIME(3) NOT NULL,INDEX idx_direct_engineer(engineerId,createdAt))`,
  `CREATE TABLE IF NOT EXISTS incentive_rewards (id VARCHAR(32) PRIMARY KEY,userId VARCHAR(32) NOT NULL,taskKey VARCHAR(32) NOT NULL,periodKey VARCHAR(16) NOT NULL,amount INT NOT NULL,status VARCHAR(16) NOT NULL DEFAULT 'RESERVED',createdAt DATETIME(3) NOT NULL,UNIQUE KEY uq_reward_business(userId,taskKey,periodKey))`,
];
async function migrate(query) {
  for (const sql of definitions) await query(sql + ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
  for (const row of [
    ['about','ABOUT','关于仿真服务平台','连接客户与仿真工程师，提供需求发布、报价沟通和项目交付管理。'],
    ['faq-orders','FAQ','如何查看订单进度？','进入“我的”或首页订单列表，打开订单详情查看状态、报价与交付材料。'],
    ['faq-report','FAQ','拉黑和举报有什么区别？','拉黑限制双方聊天；举报会提交平台审核，不会自动处罚对方。'],
  ]) await query('INSERT IGNORE INTO help_articles(id,kind,title,content,updatedAt) VALUES(?,?,?,?,UTC_TIMESTAMP(3))',row);
}
module.exports = { migrate, definitions };
