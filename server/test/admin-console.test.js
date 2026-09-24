'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let stored=null,accounts=[],statements=[],commits=0;
const config={adminBootstrapUserIds:[],adminBootstrapOpenids:[],paymentMode:'mock',uploadMaxMb:30};
mock('../src/config',{config});
mock('../src/lib/auth-mw',{requireUser:async req=>({id:req.actor || 'super'})});
const db={
  parseJson:(s,d)=>s?JSON.parse(s):d,
  query:async(sql,args=[])=>{statements.push([sql,args]);return [];},
  queryOne:async(sql,args=[])=>{
    if(sql.includes('admin_accounts'))return accounts.find(a=>a.userId===args[0] && a.status==='ACTIVE') || null;
    if(sql.includes('valueJson'))return stored==null?null:{valueJson:JSON.stringify(stored)};
    return {count:0,n:0};
  },
  tx:async fn=>{
    const before=JSON.stringify({accounts,stored});
    try {const result=await fn({execute:async(sql,args=[])=>{
      statements.push([sql,args]);
      if(sql.includes('FROM admin_accounts ORDER BY id'))return [accounts.map(a=>({...a}))];
      if(sql.includes('SELECT id,openid,status FROM users'))return [[{id:args[0],status:'ACTIVE',openid:'wx-'+args[0]}]];
      if(sql.startsWith('INSERT INTO admin_console_settings'))stored=JSON.parse(args[0]);
      if(sql.startsWith('INSERT INTO admin_accounts'))accounts.push({id:args[0],userId:args[1],adminRole:args[3],status:args[4]});
      if(sql.startsWith('UPDATE admin_accounts'))Object.assign(accounts.find(a=>a.id===args[4]),{adminRole:args[0],status:args[1]});
      return [{}];
    }});commits++;return result;}catch(e){const old=JSON.parse(before);accounts=old.accounts;stored=old.stored;throw e;}
  }
};
mock('../src/db',db);
const http=require('../src/lib/http'),mw=require('../src/lib/admin-mw'),svc=require('../src/services/admin-console');
const router=http.createRouter();require('../src/routes/admin-console').register(router);
async function call(method,url,body,actor='super',params={}) {
  const route=router.match(method,url),req=Readable.from([Buffer.from(JSON.stringify(body || {}))]);req.headers={};req.actor=actor;
  let result;await route.handler(req,{writeHead(){},end(raw){result=JSON.parse(raw).data;}},route.params,new URLSearchParams(params));return result;
}
function reset(){accounts=[{id:'a1',userId:'super',adminRole:'SUPER_ADMIN',status:'ACTIVE'},{id:'a2',userId:'reviewer',adminRole:'ENGINEER_REVIEWER',status:'ACTIVE'}];stored=null;statements=[];commits=0;config.adminBootstrapUserIds=[];}
test('配置接受整数边界，拒绝未知字段和注入文本；非法存储值不进入排序 SQL',async()=>{
  reset();assert.equal((await svc.settings()).hotQuoteWeight,3);
  for(const value of [0,20])assert.equal(svc.validateSettings({hotQuoteWeight:value}).hotQuoteWeight,value);
  for(const value of [-1,21,1.2,'3','0;DROP TABLE orders',null])assert.throws(()=>svc.validateSettings({hotQuoteWeight:value}),e=>e.status===400);
  assert.throws(()=>svc.validateSettings({hotQuoteWeight:3,autoPayout:true}));
  stored={hotQuoteWeight:'evil'};assert.equal((await svc.settings()).hotQuoteWeight,3);
});
test('配置保存落库与审计同一事务，非超级管理员不能修改',async()=>{
  reset();await assert.rejects(call('PATCH','/api/admin/console/config',{hotQuoteWeight:6},'reviewer'),e=>e.status===403);
  assert.equal(commits,0);await call('PATCH','/api/admin/console/config',{hotQuoteWeight:6});assert.equal((await svc.settings()).hotQuoteWeight,6);
  assert.equal(commits,1);assert.ok(statements.some(([sql])=>sql.startsWith('INSERT INTO admin_audit_logs')));
});
test('管理员授权支持有效角色并审计；禁止改自己、部署账号、无效角色和非管理员提权',async()=>{
  reset();const body={userId:'new-user',displayName:'财务',adminRole:'FINANCE',status:'ACTIVE'};
  await assert.rejects(call('POST','/api/admin/console/accounts',body,'reviewer'),e=>e.status===403);
  await assert.rejects(call('POST','/api/admin/console/accounts',{...body,userId:'super'}),e=>e.status===400);
  await assert.rejects(call('POST','/api/admin/console/accounts',{...body,adminRole:'constructor'}),e=>e.status===400);
  config.adminBootstrapUserIds=['new-user'];await assert.rejects(call('POST','/api/admin/console/accounts',body),e=>e.status===400);
  config.adminBootstrapUserIds=[];await call('POST','/api/admin/console/accounts',body);
  assert.equal(accounts.find(a=>a.userId==='new-user').adminRole,'FINANCE');
  assert.ok(statements.some(([sql])=>sql.includes('ORDER BY id FOR UPDATE')));
  assert.ok(statements.some(([sql,args])=>sql.includes('admin_audit_logs') && args.includes('ADMIN_ACCOUNT_UPDATE')));
});
test('停用后接口即时失去权限；财务和仲裁角色权限隔离',async()=>{
  reset();await call('POST','/api/admin/console/accounts',{userId:'reviewer',displayName:'审核',adminRole:'ENGINEER_REVIEWER',status:'DISABLED'});
  await assert.rejects(call('GET','/api/admin/console/hall',null,'reviewer'),e=>e.status===403);
  assert.ok(mw.hasPermission({adminRole:'FINANCE'},'INVOICE_PROCESS'));
  assert.ok(mw.hasPermission({adminRole:'FINANCE'},'WALLET_MANAGE'));
  assert.equal(mw.hasPermission({adminRole:'FINANCE'},'ADMIN_MANAGE'),false);
  assert.equal(mw.hasPermission({adminRole:'ARBITER'},'WALLET_MANAGE'),false);
  assert.ok(mw.hasPermission({adminRole:'ARBITER'},'DISPUTE_RESOLVE'));
});
test('存储清单不泄露云文件凭据，分页参数验证；财务日期参数不能注入',async()=>{
  reset();await call('GET','/api/admin/console/storage',null,'super',{offset:'30'});
  const sql=statements.find(([s])=>s.includes('ORDER BY createdAt DESC,id DESC'))[0];
  assert.ok(sql.includes('OFFSET 30'));assert.doesNotMatch(sql,/SELECT[^]*fileID|netdiskPassword|netdiskUrl,/);
  await assert.rejects(call('GET','/api/admin/console/storage',null,'super',{offset:'-1'}),e=>e.status===400);
  await assert.rejects(call('GET','/api/admin/console/finance',null,'super',{days:'30;DROP'}),e=>e.status===400);
});
test('工作台菜单按实际权限过滤且所有入口均指向已注册页面',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const {navigation}=require('../../miniapp/admin/utils/navigation');
  const app=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../miniapp/app.json'),'utf8'));
  const routes=new Set(app.subPackages.flatMap(p=>p.pages.map(x=>'/'+p.root+'/'+x)));
  const all=navigation({adminRole:'SUPER_ADMIN'},{engineerReviews:{pending:2},pendingTasks:{enterprise:4}},mw.hasPermission);
  for(const item of all.flatMap(g=>g.items))assert.ok(routes.has(item.path.split('?')[0]),item.path);
  const reviewer=navigation({adminRole:'ENGINEER_REVIEWER'},{},mw.hasPermission).flatMap(g=>g.items);
  assert.equal(reviewer.some(i=>i.key==='accounts'),false);assert.equal(reviewer.some(i=>i.key==='wallet'),false);
  assert.equal(all.flatMap(g=>g.items).find(i=>i.key==='enterprise').count,4);
});
