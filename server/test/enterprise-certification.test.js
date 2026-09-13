'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const realHttp=require('../src/lib/http');
let row=null,audits=0;
const db={parseJson:v=>typeof v==='string'?JSON.parse(v):v,query:async()=>[],queryOne:async(sql)=>sql.includes("status='APPROVED'")?(row?.status==='APPROVED'?{companyName:row.companyName}:null):row,tx:async fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT id FROM users'))return [[{id:a[0]}]];
 if(sql.startsWith('SELECT status FROM enterprise'))return [[row].filter(Boolean)];
 if(sql.startsWith('SELECT id FROM enterprise_documents'))return [[a[0]==='owned'?{id:'owned'}:null].filter(Boolean)];
 if(sql.startsWith('INSERT INTO enterprise_certifications')){row={userId:a[0],companyName:a[1],creditCode:a[2],evidence:a[3],status:'PENDING',revision:1};return [{affectedRows:1}];}
 if(sql.startsWith('UPDATE enterprise_certifications SET status=')){if(!row||row.status!=='PENDING'||row.revision!==a[3])return [{affectedRows:0}];row.status=a[0];return [{affectedRows:1}];}
 throw Error(sql);
}})};
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
mock('../src/db',db);mock('../src/lib/http',{...realHttp,readJson:async req=>req.body});
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});
mock('../src/lib/admin-mw',{requireAdmin:async(req,permission)=>{assert.equal(permission,'IDENTITY_APPROVE');if(!req.admin)throw realHttp.err.forbidden();return {user:req.user,admin:{id:'admin'}};},writeAdminAudit:async()=>{audits++;}});
mock('../src/services/enterprise-documents',{upload:async()=>({id:'owned'}),read:async()=>({})});
const {register,badge}=require('../src/routes/delivery-enterprise');const router=realHttp.createRouter();register(router);
async function call(path,user,body,admin=false){const r=router.match('POST',path);let data;await r.handler({user,body,admin},{writeHead(){},end(s){data=JSON.parse(s).data;}},r.params);return data;}
test('企业材料归属、重复提交、审核权限、自审禁止、版本及公开标识',async()=>{
 const u={id:'e',role:'ENGINEER'},form={companyName:'测试企业',creditCode:'91310000MA12345678',evidence:['owned']};
 await assert.rejects(call('/api/enterprise',{id:'c',role:'CUSTOMER'},form),e=>e.status===403);
 await assert.rejects(call('/api/enterprise',u,{...form,evidence:['foreign']}),e=>e.status===403);
 await call('/api/enterprise',u,form);assert.equal(await badge('e'),null);
 await assert.rejects(call('/api/enterprise',u,form),e=>e.status===409);
 const decision={status:'APPROVED',result:'材料审核通过',revision:1};
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},decision),e=>e.status===403);
 await assert.rejects(call('/api/admin/enterprise/e',u,decision,true),e=>e.status===403);
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},{...decision,revision:2},true),e=>e.status===409);
 await call('/api/admin/enterprise/e',{id:'a'},decision,true);assert.equal((await badge('e')).label,'企业已认证');assert.equal(audits,1);
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},decision,true),e=>e.status===409);
});
