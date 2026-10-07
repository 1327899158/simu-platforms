'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let saved, exposure;
mock('../src/db',{parseJson:s=>typeof s==='string'?JSON.parse(s):s,nextOrderNo:async()=> 'ORDER1',tx:async fn=>fn({execute:async(sql,args)=>{
  if(sql.includes('INSERT INTO orders')){assert.equal(args.length,14);saved={id:args[0],promotion:args[13],status:'QUOTING',softwareTags:args[5],directionTags:args[6]};return [{}];}
  if(sql.includes('INSERT INTO order_exposures')){exposure={orderId:args[0],customerId:args[1],targetPeople:args[2],amountFen:args[3]};return [{}];}
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
test('公开曝光发布创建19元/100人待付款记录，旧客户端默认普通发布',async()=>{
  for(const promotion of ['NONE','EXPOSURE'])assert.equal((await publish(promotion)).promotion,promotion);
  assert.deepEqual(exposure,{orderId:saved.id,customerId:'customer',targetPeople:100,amountFen:1900});
  assert.equal((await publish()).promotion,'NONE');
});
test('拒绝无效推广和定向需求公开推广',async()=>{
  for(const promotion of ['invalid',null,{},'URGENT','EXPOSURE,URGENT'])await assert.rejects(publish(promotion),e=>e.status===400);
  await assert.rejects(publish('URGENT','engineer'),e=>e.status===400);
  await assert.rejects(publish('EXPOSURE','engineer'),e=>e.status===400);
});
test('分页游标按时间与ID定位，拒绝旧加急排序及跨位置游标',()=>{
  const row={id:'c123',createdAt:new Date('2026-09-24T02:01:00.123Z'),promotion:'URGENT'};
  const cursor=encodeCursor(row,'hall'),c=decodeCursor(cursor,'hall');
  assert.equal(c.r,0);assert.equal(c.id,'c123');assert.equal(c.t,'2026-09-24 02:01:00.123');
  assert.throws(()=>decodeCursor(Buffer.from(JSON.stringify({...c,r:1})).toString('base64url'),'hall'),e=>e.status===400);
  assert.equal(decodeCursor(encodeCursor({...row,promotion:'NONE'},'hall'),'hall').r,0);
  assert.throws(()=>decodeCursor(cursor,'home'),e=>e.status===400);
  assert.throws(()=>decodeCursor('bad','hall'),e=>e.status===400);
});
