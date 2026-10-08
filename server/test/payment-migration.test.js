'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {migrate}=require('../src/services/payment-migration');
test('支付迁移保留历史云托管通道，添加商户快照和唯一退款业务编号',async()=>{
 const sqls=[];await migrate(async sql=>{sqls.push(sql);return [];});
 assert.equal(sqls.filter(s=>s.startsWith('ALTER TABLE')).length,6);
 assert.equal(sqls.filter(s=>s.includes("DEFAULT 'cloudbase'")).length,2);
 const refunds=sqls.find(s=>s.includes('CREATE TABLE'));assert.match(refunds,/businessKey VARCHAR\(80\) NOT NULL UNIQUE/);assert.match(refunds,/outRefundNo VARCHAR\(32\) NOT NULL UNIQUE/);
 assert.match(refunds,/COLLATE=utf8mb4_unicode_ci/);assert(sqls.filter(s=>s.startsWith('SHOW')).every(s=>!s.includes('?')));
});
test('重复和并发迁移可重试，非重复字段DDL错误不会被吞掉',async()=>{
 const sqls=[];await migrate(async sql=>{sqls.push(sql);return sql.startsWith('SHOW')?[{}]:[];});assert.equal(sqls.filter(s=>s.startsWith('ALTER TABLE')).length,0);
 await migrate(async sql=>{if(sql.startsWith('ALTER TABLE'))throw Object.assign(Error('duplicate'),{code:'ER_DUP_FIELDNAME'});return [];});
 await assert.rejects(migrate(async sql=>{if(sql.startsWith('ALTER TABLE'))throw Error('permission denied');return [];}),/permission denied/);
});
