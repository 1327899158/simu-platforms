const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const http=require('../src/lib/http');let row=null,inserts=0,sqls=[];
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});
mock('../src/lib/admin-mw',{requireAdmin:async req=>{if(!req.admin)throw http.err.forbidden();}});
mock('../src/db',{query:async sql=>{sqls.push(sql);return [];},tx:async fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT id FROM users'))return [[{id:a[0]}]];
 if(sql.startsWith('SELECT id FROM service_tickets'))return [row?[row]:[]];
 if(sql.startsWith('INSERT INTO service_tickets')){assert.match(sql,/'CHAT'/);row={id:a[0]};inserts++;return [{}];}
 throw Error(sql);
}})});
const router=http.createRouter();require('../src/routes/customer-service').register(router);
async function call(method,url,channel='TICKET',admin=false){let result;const r=router.match(method,url);await r.handler({user:{id:'u',role:'CUSTOMER'},admin},{writeHead(){},end(s){result=JSON.parse(s).data;}},r.params,new URLSearchParams({channel}));return result;}
test('直接咨询无需工单表单，重复进入复用会话；双端列表按类型隔离',async()=>{
 const first=await call('POST','/api/service-chats');assert.ok(first.id);
 assert.equal((await call('POST','/api/service-chats')).id,first.id);assert.equal(inserts,1);
 for(const channel of ['CHAT','TICKET']){
  await call('GET','/api/service-tickets',channel);assert.ok(sqls.at(-1).includes("channel='"+channel+"'"));
  await call('GET','/api/admin/service-tickets',channel,true);assert.ok(sqls.at(-1).includes("t.channel='"+channel+"'"));
 }
 await assert.rejects(call('GET','/api/admin/service-tickets','CHAT'),e=>e.status===403);
});
test('立即咨询打开聊天，提交工单打开独立表单',async()=>{
 let definition;const requests=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../miniapp/components/service-desk/index.js'),'utf8'),{
  Component:d=>definition=d,require:()=>({request:async(method,url)=>{requests.push(url);return url==='/service-chats'?{id:'c'}:{id:'c',channel:'CHAT',status:'OPEN',messages:[]};}}),wx:{showToast(){}},
 });
 const instance={...definition.methods,data:{...definition.data},_active:true,setData(p,cb){Object.assign(this.data,p);if(cb)cb();}};
 await instance.consult();assert.equal(instance.data.form,false);assert.equal(instance.data.detail.channel,'CHAT');assert.equal(requests[0],'/service-chats');
 instance.create();assert.equal(instance.data.form,true);assert.equal(instance.data.detail,null);assert.equal(instance.data.channel,'TICKET');
});
