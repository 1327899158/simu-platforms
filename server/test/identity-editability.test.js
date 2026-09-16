'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assertIdentityEditable}=require('../src/services/identity-svc');
function conn(identity,legacy){let calls=0;return {execute:async(sql)=>{assert.match(sql,/FOR UPDATE$/);calls++;if(calls===1){assert.match(sql,/FROM users/);return [[{id:'u'}]];}return [[calls===2?identity:legacy].filter(Boolean)];}};}
test('认证审核中和已通过禁止再次提交或修改材料，包括旧工程师认证',async()=>{
 for(const [identity,legacy] of [[{verifyStatus:'APPROVED'},null],[{verifyStatus:'PENDING',submittedAt:new Date()},null],[null,{verifyStatus:'APPROVED'}]]){
  await assert.rejects(assertIdentityEditable(conn(identity,legacy),'u'),e=>e.status===409);
 }
});
test('未申请及审核驳回允许提交，PENDING占位记录不是已提交申请',async()=>{
 for(const identity of [null,{verifyStatus:'PENDING',submittedAt:null},{verifyStatus:'REJECTED',submittedAt:new Date()}])await assertIdentityEditable(conn(identity,null),'u');
});
