'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');const {createRouter}=require('../src/lib/http');
let saved,owner=true,queried;
const order={id:'o',projectName:'仿真项目',orderNo:'SIM001'};
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});mock('../src/lib/admin-mw',{requireAdmin:async()=>({})});
mock('../src/db',{
 parseJson:JSON.parse,
 query:async(sql,args)=>{queried={sql,args};return sql.includes('FROM orders')?[order]:[];},
 queryOne:async()=>saved,
 tx:async fn=>fn({execute:async(sql,args)=>{
  if(sql.startsWith('SELECT id FROM users'))return [[{id:'u'}]];
  if(sql.startsWith('SELECT COUNT'))return [[{n:0}]];
  if(sql.startsWith('SELECT o.id')){assert.equal(args[1],'u');return [owner?[order]:[]];}
  if(sql.startsWith('INSERT INTO service_tickets')){saved={id:args[0],userId:args[1],evidence:'[]',relatedOrder:args[6]};return [{affectedRows:1}];}
  throw Error(sql);
 }}),
});
const router=createRouter();require('../src/routes/customer-service').register(router);
async function call(method,path,body={},role='CUSTOMER',search=''){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.user={id:'u',role};let data;
 const route=router.match(method,path);await route.handler(req,{writeHead(){},end(s){data=JSON.parse(s).data;}},route.params,new URLSearchParams(search));return data;
}
test('订单候选按本人筛选，名称搜索参数化；工单保存服务端订单快照，拒绝他人订单',async()=>{
 await call('GET','/api/service-ticket-orders',{},'CUSTOMER','search=SIM001');assert.match(queried.sql,/o.customerId=\?/);assert.deepEqual(queried.args,['u','%SIM001%','%SIM001%']);
 await call('GET','/api/service-ticket-orders',{},'ENGINEER');assert.match(queried.sql,/EXISTS.*q.engineerId=\?/);
 const body={category:'订单/交易',title:'订单问题',content:'需要客服协助处理',orderId:'o',projectName:'伪造标题'};
 await call('POST','/api/service-tickets',body);assert.deepEqual(JSON.parse(saved.relatedOrder),order);
 assert.deepEqual((await call('GET','/api/service-tickets/'+saved.id)).relatedOrder,order);
 owner=false;await assert.rejects(call('POST','/api/service-tickets',body),e=>e.status===403);
 await call('POST','/api/service-tickets',{...body,orderId:undefined});assert.equal(saved.relatedOrder,null);
});
