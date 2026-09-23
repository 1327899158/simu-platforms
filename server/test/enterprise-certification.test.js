'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const realHttp=require('../src/lib/http');
let row=null,audits=0;
const db={parseJson:v=>typeof v==='string'?JSON.parse(v):v,query:async()=>[],queryOne:async(sql)=>sql.includes("status='APPROVED'")?(row?.status==='APPROVED'?{companyName:row.companyName,displayLabel:row.displayLabel,certificationType:row.certificationType}:null):row,tx:async fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT id FROM users'))return [[{id:a[0]}]];
 if(sql.startsWith('SELECT status FROM enterprise'))return [[row].filter(Boolean)];
 if(sql.startsWith('SELECT id FROM enterprise_documents'))return [[a[0]==='owned'?{id:'owned'}:null].filter(Boolean)];
 if(sql.startsWith('INSERT INTO enterprise_certifications')){row={userId:a[0],companyName:a[1],creditCode:a[2],evidence:a[3],certificationType:a[4],applicationNote:a[5],status:'PENDING',revision:1};return [{affectedRows:1}];}
 if(sql.startsWith('UPDATE enterprise_certifications SET status=')){if(!row||row.status!=='PENDING'||row.revision!==a[4])return [{affectedRows:0}];row.status=a[0];row.displayLabel=a[2];return [{affectedRows:1}];}
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
 const decision={displayLabel:'测试企业认证',status:'APPROVED',result:'材料审核通过',revision:1};
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},decision),e=>e.status===403);
 await assert.rejects(call('/api/admin/enterprise/e',u,decision,true),e=>e.status===403);
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},{...decision,revision:2},true),e=>e.status===409);
 await call('/api/admin/enterprise/e',{id:'a'},decision,true);assert.equal((await badge('e')).label,'测试企业认证');assert.equal(audits,1);
 await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},decision,true),e=>e.status===409);
});

test('企业审核列表统一关联排序规则，并保留权限、分页和材料解析',async()=>{
 const route=router.match('GET','/api/admin/enterprise');
 let calls=0,lastSql;
 const rows=Array.from({length:21},(_,i)=>({userId:`e${i}`,nickname:`工程师${i}`,evidence:'["owned"]'}));
 const original=db.query;
 // 路由在加载时解构 query；通过重新加载路由注入列表数据。
 db.query=async sql=>{calls++;lastSql=sql;return rows;};
 delete require.cache[require.resolve('../src/routes/delivery-enterprise')];
 const listRouter=realHttp.createRouter();require('../src/routes/delivery-enterprise').register(listRouter);
 const handler=listRouter.match('GET','/api/admin/enterprise').handler;
 async function list(admin,offset='0'){
  let data;await handler({user:{id:'a'},admin},{writeHead(){},end(s){data=JSON.parse(s).data;}},route.params,new URLSearchParams({offset}));return data;
 }
 try{
  await assert.rejects(list(false),e=>e.status===403);assert.equal(calls,0);
  const result=await list(true,'20');
  assert.equal(result.hasMore,true);assert.equal(result.items.length,20);
  assert.deepEqual(result.items[0],{userId:'e0',nickname:'工程师0',evidence:['owned']});
  assert.match(lastSql,/u\.id COLLATE utf8mb4_unicode_ci\s*=\s*e\.userId COLLATE utf8mb4_unicode_ci/);
  assert.match(lastSql,/LIMIT 21 OFFSET 20/);
  await assert.rejects(list(true,'-1'),e=>e.status===400);assert.equal(calls,1);
  rows.length=0;assert.deepEqual(await list(true),{items:[],hasMore:false});
 }finally{db.query=original;}
});


test('机构和毕业院校可无信用代码提交，用户不能决定公开标签',async()=>{
 for(const certificationType of ['INSTITUTION','SCHOOL']){
  row=null;
  await call('/api/enterprise',{id:'e',role:'ENGINEER'},{companyName:'测试大学',certificationType,applicationNote:'毕业于计算机专业',displayLabel:'自行认证',evidence:['owned']});
  assert.equal(row.creditCode,null);assert.equal(row.certificationType,certificationType);assert.equal(row.applicationNote,'毕业于计算机专业');assert.equal(await badge('e'),null);
  const decision={status:'APPROVED',result:'核对材料通过',revision:1};
  await assert.rejects(call('/api/admin/enterprise/e',{id:'a'},decision,true),e=>e.status===400);
  await call('/api/admin/enterprise/e',{id:'a'},{...decision,displayLabel:'测试大学毕业'},true);
  assert.equal((await badge('e')).label,'测试大学毕业');
 }
 row=null;
 await assert.rejects(call('/api/enterprise',{id:'e',role:'ENGINEER'},{companyName:'测试企业',certificationType:'COMPANY',evidence:['owned']}),e=>e.status===400);
 await assert.rejects(call('/api/enterprise',{id:'e',role:'ENGINEER'},{companyName:'测试机构',certificationType:'INSTITUTION',creditCode:'bad',evidence:['owned']}),e=>e.status===400);
});

test('增量迁移兼容旧申请并可重复执行',async()=>{
 const {migrate}=require('../src/services/delivery-enterprise-migration');
 const columns=[{Field:'creditCode',Null:'NO'}],changes=[];
 const query=async sql=>{
  if(sql.startsWith('SHOW COLUMNS'))return columns;
  if(sql.includes('ADD COLUMN')){changes.push(sql);columns.push({Field:sql.split('ADD COLUMN ')[1].split(' ')[0]});}
  if(sql.includes('MODIFY COLUMN')){changes.push(sql);columns[0].Null='YES';}
  return [];
 };
 await migrate(query);assert.equal(changes.length,4);
 await migrate(query);assert.equal(changes.length,4);
});
