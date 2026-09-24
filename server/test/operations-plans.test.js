const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={loaded:true,exports};};
let plans=[],auditFail=false,allowed=true,audits=0;
mock('../src/db',{parseJson:(x,d)=>x?JSON.parse(x):d,tx:async fn=>{const before=JSON.stringify(plans);try{return await fn({execute:async(sql,args)=>{
 if(sql.startsWith('SELECT valueJson'))return [[{valueJson:JSON.stringify(plans)}]];
 if(sql.startsWith('UPDATE admin_console_settings'))plans=JSON.parse(args[0]);return [{}];
}});}catch(e){plans=JSON.parse(before);throw e;}}});
mock('../src/lib/admin-mw',{ROLE_PERMISSIONS:{},requireAdmin:async(req,p)=>{assert.equal(p,'CONFIG_MANAGE');if(!allowed)throw Object.assign(Error('forbidden'),{status:403});return {admin:{id:'a',displayName:'运营'}};},writeAdminAudit:async()=>{if(auditFail)throw Error('audit failed');audits++;}});
const router=require('../src/lib/http').createRouter();require('../src/routes/admin-console').register(router);
const call=body=>router.match('POST','/api/admin/console/operations/plans').handler(Readable.from([Buffer.from(JSON.stringify(body))]),{writeHead(){},end(){}},{});
test('措施要求配置权限和有效日期，审计失败回滚保存',async()=>{
 const body={title:'优化报价',goal:'降低无人报价比例',startDate:'2026-09-24'};
 allowed=false;await assert.rejects(call(body),e=>e.status===403);allowed=true;
 await assert.rejects(call({...body,startDate:'2026-02-30'}));assert.equal(plans.length,0);
 auditFail=true;await assert.rejects(call(body),/audit failed/);assert.equal(plans.length,0);
 auditFail=false;await call(body);assert.equal(plans.length,1);assert.equal(plans[0].owner,'运营');assert.equal(audits,1);
 plans=Array(100).fill({});await assert.rejects(call(body),e=>e.status===409);
});
