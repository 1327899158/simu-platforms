'use strict';
module.exports = async function migrate(query) {
  await query(`CREATE TABLE IF NOT EXISTS home_campaigns (id VARCHAR(32) PRIMARY KEY, title VARCHAR(120) NOT NULL, subtitle VARCHAR(240) NOT NULL, content TEXT NOT NULL, action VARCHAR(20) NOT NULL, enabled TINYINT NOT NULL DEFAULT 1, sortOrder INT NOT NULL DEFAULT 0, updatedAt DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const defaults = [
    ['welcome','新人礼包 · 满1000减50','新用户专享券已到账，下单立省。','新人专享满1000减50。优惠资格、领取及使用规则以平台实际发放记录为准。','PUBLISH',0],
    ['first','首单立减30元','完成首次发布需求即可获得。','完成首次发布需求即可获得首单优惠。是否可用以实际发放记录为准。','PUBLISH',1],
    ['invite','邀请好友赚仿真币：好友注册您得50币','首单完成再得250币，无上限。','邀请好友注册得50币，好友首单完成再得250币。奖励以平台核验及实际入账为准。','SHARE',2],
  ];
  for (const row of defaults) await query(`INSERT IGNORE INTO home_campaigns(id,title,subtitle,content,action,sortOrder,updatedAt) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(3))`,row);
  const columns = { levelKey: "VARCHAR(24) NOT NULL DEFAULT 'UNQUALIFIED'", completedOrderCount: 'INT NOT NULL DEFAULT 0', positiveReviewRate: 'DECIMAL(8,4) NULL', disputeRate: 'DECIMAL(8,4) NOT NULL DEFAULT 0', levelUpdatedAt: 'DATETIME(3) NULL' };
  for (const [name,type] of Object.entries(columns)) {
    // 腾讯云 TDSQL 不支持在 SHOW COLUMNS 的 LIKE 子句中使用预处理占位符。
    // name 仅来自上面的静态白名单，因此可以安全地直接写入 SQL。
    const found = await query(`SHOW COLUMNS FROM engineer_profiles LIKE '${name}'`);
    if (!found.length) {
      try { await query(`ALTER TABLE engineer_profiles ADD COLUMN ${name} ${type}`); }
      catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
    }
  }
  const orderColumn = await query("SHOW COLUMNS FROM conversations LIKE 'orderId'");
  if (orderColumn[0].Null === 'NO') await query('ALTER TABLE conversations MODIFY orderId VARCHAR(32) NULL');
  const direct = await query("SHOW COLUMNS FROM conversations LIKE 'directKey'");
  if (!direct.length) {
    try { await query('ALTER TABLE conversations ADD COLUMN directKey VARCHAR(70) NULL UNIQUE'); }
    catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  }
};
