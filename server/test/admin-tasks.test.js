'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
let queries=[];
require.cache[require.resolve('../src/db')]={loaded:true,exports:{queryOne:async sql=>{queries.push(sql);return {n:'2'};}}};
const {pendingTasks}=require('../src/services/admin-tasks');
test('管理员待办只统计有权限的功能和未处理状态',async()=>{
 const all=await pendingTasks({adminRole:'SUPER_ADMIN'});
 assert.equal(Object.keys(all).length,6);assert.equal(all.enterprise,2);assert.equal(all.wallet,2);
 assert.ok(queries.some(sql=>sql.includes("status='PLATFORM_REQUESTED'")));
 queries=[];
 const reviewer=await pendingTasks({adminRole:'ENGINEER_REVIEWER'});
 assert.deepEqual(reviewer,{enterprise:2});assert.equal(queries.length,1);
});
