'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
const seen=new Set();let views=0,listingSQL='',listingArgs=[];
const order=()=>({id:'o',customerId:'c',status:'QUOTING',description:'需求',viewCount:views,createdAt:'2026-09-10'});
mock('../src/db',{
 query:async (sql,args)=>{listingSQL=sql;listingArgs=args;return [order()];},
 queryOne:async sql=>sql.includes('SELECT * FROM orders')?order():sql.includes('allCount')?{allCount:1,todayCount:1}:null,
 tx:async work=>work({execute:async(sql,args)=>{
  if(sql.includes('INSERT IGNORE INTO order_views')){const key=args.join(':');if(seen.has(key))return [{affectedRows:0}];seen.add(key);return [{affectedRows:1}];}
  if(sql.includes('UPDATE orders')){views++;return [{affectedRows:1}];}
  throw Error(sql);
 }})
});
mock('../src/lib/auth-mw',{requireEngineer:async req=>req.user});
mock('../src/routes/orders',{orderView:(o,extra)=>({...o,...extra}),quoteCountOf:async()=>0});
mock('../src/services/customer-review-svc',{reviewView:()=>null});
mock('../src/services/cooperation-svc',{assertScope:async()=>{}});
const router=require('../src/lib/http').createRouter();
require('../src/routes/market').register(router);
async function call(path,id,search=''){const route=router.match('GET',path);let result;await route.handler({user:{id}},{writeHead(){},end(raw){result=JSON.parse(raw).data;}},route.params,new URLSearchParams(search));return result;}
test('同一账号重复查看只计一次，不同账号独立累计',async()=>{
 assert.equal((await call('/api/market/orders/o','e1')).viewCount,1);
 assert.equal((await call('/api/market/orders/o','e1')).viewCount,1);
 assert.equal((await call('/api/market/orders/o','e2')).viewCount,2);
 await assert.rejects(call('/api/market/orders/o','c'),e=>e.status===403);
 assert.equal(views,2);
});
test('热度排序报价权重为浏览三倍，排除撤销报价，保留去重数据库约束',async()=>{
 await call('/api/market/orders','e1','sort=hot');
 assert.match(listingSQL,/quoteCount \* 3 \+ o.viewCount/);
 assert.match(listingSQL,/qc.status != 'WITHDRAWN'/);
 const schema=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/db.js'),'utf8');
 assert.match(schema,/PRIMARY KEY\(orderId, userId\)/);
});
test('需求搜索覆盖标题、内容和方向，转义通配符且不扩大可见范围',async()=>{
 await call('/api/market/orders','e1','keyword='+encodeURIComponent('结构_100%'));
 assert.match(listingSQL,/o.projectName LIKE/);
 assert.match(listingSQL,/o.description LIKE/);
 assert.match(listingSQL,/o.directionTags LIKE/);
 assert.deepEqual(listingArgs.slice(-3),Array(3).fill('%结构!_100!%%'));
 assert.match(listingSQL,/o.status = 'QUOTING'/);
 assert.match(listingSQL,/NOT EXISTS/);
 await assert.rejects(call('/api/market/orders','e1','keyword='+'a'.repeat(81)),e=>e.status===400);
});
