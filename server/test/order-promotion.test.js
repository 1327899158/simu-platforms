'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let saved;
mock('../src/db',{parseJson:s=>typeof s==='string'?JSON.parse(s):s,nextOrderNo:async()=> 'ORDER1',tx:async fn=>fn({execute:async(sql,args)=>{
  if(sql.includes('INSERT INTO orders')){assert.equal(args.length,14);saved={id:args[0],promotion:args[13],status:'QUOTING',softwareTags:args[5],directionTags:args[6]};return [{}];}
  if(sql.includes('SELECT * FROM orders'))return [[saved]];
  throw Error(sql);
}})});
mock('../src/lib/auth-mw',{requireVerifiedCustomer:async()=>({id:'customer'})});
mock('../src/services/pay-svc',{});mock('../src/services/chat-svc',{});mock('../src/services/engineer-level',{});mock('../src/services/dispute-svc',{});
mock('../src/services/cooperation-svc',{attachDirect:async()=>null});
const {createRouter}=require('../src/lib/http');const router=createRouter();require('../src/routes/orders').register(router);
const {encodeCursor,decodeCursor}=require('../src/services/order-promotion');
async function publish(promotion,directEngineerId) {
  const req=Readable.from([Buffer.from(JSON.stringify({projectName:'仿真测试需求',description:'需要提供详细的仿真分析结果以及相应的模型和文档',softwareTags:['ANSYS'],directionTags:['结构'],deliveryDays:7,promotion,directEngineerId}))]);
  req.headers={};let result;await router.match('POST','/api/orders').handler(req,{writeHead(){},end(s){result=JSON.parse(s).data;}});return result;
}
test('发布选项保存到订单并返回，旧客户端默认普通发布',async()=>{
  for(const promotion of ['NONE','EXPOSURE','URGENT'])assert.equal((await publish(promotion)).promotion,promotion);
  assert.equal((await publish()).promotion,'NONE');
});
test('拒绝无效推广和定向需求公开推广',async()=>{
  for(const promotion of ['invalid',null,{},'EXPOSURE,URGENT'])await assert.rejects(publish(promotion),e=>e.status===400);
  await assert.rejects(publish('URGENT','engineer'),e=>e.status===400);
  await assert.rejects(publish('EXPOSURE','engineer'),e=>e.status===400);
});
test('分页游标保留优先级、同时间ID与展示位置，拒绝跨位置游标',()=>{
  const row={id:'c123',createdAt:new Date('2026-09-24T02:01:00.123Z'),promotion:'URGENT'};
  const cursor=encodeCursor(row,'hall'),c=decodeCursor(cursor,'hall');
  assert.equal(c.r,1);assert.equal(c.id,'c123');assert.equal(c.t,'2026-09-24 02:01:00.123');
  assert.equal(decodeCursor(encodeCursor({...row,promotion:'NONE'},'hall'),'hall').r,0);
  assert.throws(()=>decodeCursor(cursor,'home'),e=>e.status===400);
  assert.throws(()=>decodeCursor('bad','hall'),e=>e.status===400);
});
