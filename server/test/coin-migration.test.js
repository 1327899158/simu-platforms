'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{migrate}=require('../src/services/coin-migration');
test('旧数据库增加抵扣字段并扩大奖励业务编号，兼容TDSQL的SHOW列限制',async()=>{
 const sqls=[];await migrate(async sql=>{sqls.push(sql);if(sql.includes("LIKE 'periodKey'"))return [{Type:'varchar(16)'}];return [];});
 assert.equal(sqls.filter(s=>s.startsWith('CREATE TABLE')).length,4);assert(sqls.some(s=>s.includes('ADD COLUMN grossAmountFen BIGINT NULL')));assert(sqls.some(s=>s.includes('ADD COLUMN cashAmountFen BIGINT NULL')));assert(sqls.some(s=>s.includes('ADD COLUMN linkEnvVersion')));assert(sqls.some(s=>s.includes('MODIFY periodKey VARCHAR(64)')));assert(sqls.filter(s=>s.startsWith('SHOW COLUMNS')).every(s=>!s.includes('?')));
});
test('重复启动无需重建列；并发添加列的重复字段错误可安全忽略',async()=>{
 const sqls=[];await migrate(async sql=>{sqls.push(sql);if(sql.startsWith('SHOW'))return [{Type:'varchar(64)'}];return [];});assert.equal(sqls.filter(s=>s.startsWith('ALTER TABLE')).length,0);
 await migrate(async sql=>{if(sql.startsWith('ALTER TABLE'))throw Object.assign(Error('duplicate'),{code:'ER_DUP_FIELDNAME'});return [];});
});
