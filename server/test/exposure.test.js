'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
const config={paymentMode:'wechat',wxpayMchid:'merchant',wxAppid:'app',cloudbaseEnv:'env',wxpayCallbackService:'simu-api'};
let order,ledger,direct,tokens,sqls,gatewayCalls,gatewayResponse,queue=Promise.resolve();
const copy=x=>x&&{...x};
async function execute(sql,args){
 sqls.push(sql);
 if(sql.startsWith('SELECT')&&sql.includes('FROM orders'))return [[...(order&&(!sql.includes('customerId=?')||args[1]===order.customerId)?[copy(order)]:[])]];
 if(sql.startsWith('SELECT')&&sql.includes('FROM direct_demands'))return [[...(direct?[{orderId:'o'}]:[])]];
 if(sql.startsWith('SELECT')&&sql.includes('FROM order_exposures'))return [[...(ledger?[copy(ledger)]:[])]];
 if(sql.startsWith('INSERT INTO order_exposures')){ledger={orderId:args[0],customerId:args[1],targetPeople:args[2],amountFen:args[3],outTradeNo:args[4],deliveredPeople:0,paymentStatus:'PENDING'};}
 else if(sql.startsWith('UPDATE order_exposures SET targetPeople='))Object.assign(ledger,{targetPeople:args[0],amountFen:args[1],paymentStartedAt:'now',paymentMode:args[2],provider:args[3]});
 else if(sql.startsWith("UPDATE order_exposures SET paymentStatus='SUCCESS'"))Object.assign(ledger,{paymentStatus:'SUCCESS',transactionId:args[0],paymentMode:args[1],paidAt:'now'});
 else if(sql.startsWith('UPDATE order_exposures SET deliveredPeople='))ledger.deliveredPeople++;
 else if(sql.startsWith('UPDATE orders'))order.promotion='EXPOSURE';
 else if(sql.startsWith('UPDATE exposure_deliveries')){
  const row=tokens[args[1]],applied=!!(row&&row.token===args[2]&&!row.seen&&!row.expired);
  if(applied)row.seen=true;
  return [{affectedRows:applied?1:0}];
 }else throw Error('Unexpected SQL: '+sql);
 return [{affectedRows:1}];
}
mock('../src/config',{config});
mock('../src/db',{
 // 模拟行锁串行化并回滚失败事务，用并发请求验证最后一个名额只递增一次。
 tx:fn=>{const run=queue.then(async()=>{const snapshot=JSON.stringify({order,ledger,tokens});try{return await fn({execute});}catch(e){({order,ledger,tokens}=JSON.parse(snapshot));throw e;}});queue=run.catch(()=>{});return run;},
 queryOne:async(sql,args)=>{
  sqls.push(sql);
  if(sql.includes('FROM orders'))return order&&order.customerId===args[1]?copy(order):null;
  if(sql.includes('FROM exposure_deliveries'))return tokens[args[1]];
  if(sql.includes('FROM order_exposures')){
   if(sql.includes('customerId=?')&&ledger?.customerId!==args[1])return null;
   return ledger?{...ledger,orderStatus:order.status,deletedAt:order.deletedAt}:null;
  }
  throw Error(sql);
 },
 query:async(sql,args)=>{
  sqls.push(sql);
  if(sql.startsWith('SELECT o.*'))return ledger?.paymentStatus==='SUCCESS'&&ledger.deliveredPeople<ledger.targetPeople&&order.status==='QUOTING'&&!order.deletedAt&&!direct&&order.customerId!==args[0]&&!tokens[args[0]]?.seen?[copy(order)]:[];
  if(sql.startsWith('INSERT INTO exposure_deliveries')){if(!tokens[args[1]])tokens[args[1]]={token:args[2]};return {};}
  throw Error(sql);
 }
});
mock('../src/services/pay-svc',{paymentProvider:()=>config.paymentMode==='mock'?'mock':'cloudbase',assertPaymentAccount:()=>{},assertPaymentConfigured:()=>{},wxpayRequest:async(method,path,body)=>{gatewayCalls.push({method,path,body});return gatewayResponse;},cloudPayResult:r=>r});
mock('../src/lib/auth-mw',{
 requireCustomer:async req=>{if(req.user?.role!=='CUSTOMER')throw Object.assign(Error('forbidden'),{status:403});return req.user;},
 requireEngineer:async req=>{if(req.user?.role!=='ENGINEER'||!req.user.approved)throw Object.assign(Error('forbidden'),{status:403});return req.user;}
});
mock('../src/routes/orders',{orderView:(o,extra)=>({...o,...extra})});
const svc=require('../src/services/exposure-svc'),router=require('../src/lib/http').createRouter();require('../src/routes/exposure').register(router);
beforeEach(()=>{
 config.paymentMode='wechat';order={id:'o',customerId:'c',status:'QUOTING',promotion:'NONE'};
 ledger={orderId:'o',customerId:'c',targetPeople:100,deliveredPeople:0,amountFen:1900,outTradeNo:'trade',paymentStatus:'PENDING'};
 direct=false;tokens={e1:{token:'token1'},e2:{token:'token2'}};sqls=[];gatewayCalls=[];
 gatewayResponse={trade_state:'SUCCESS',out_trade_no:'trade',sub_appid:'app',sub_mch_id:'merchant',total_fee:1900,transaction_id:'wx-transaction'};
});
const customer={id:'c',role:'CUSTOMER',openid:'openid'},engineer={id:'e1',role:'ENGINEER',approved:true};
async function call(method,url,body={},user=customer){const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.headers={};req.user=user;const route=router.match(method,url);let result,status;await route.handler(req,{writeHead(s){status=s;},end(raw){result=JSON.parse(raw);}},route.params);return {status,result};}
test('曝光份数限制，服务端以19元/100人计算；重试保留原支付单金额',async()=>{
 for(const n of [0,-1,1.5,101])assert.throws(()=>svc.quantity(n),e=>e.status===400);
 ledger=null;gatewayResponse={payment:{timeStamp:'123',nonceStr:'nonce',package:'prepay_id=x',paySign:'sig'}};
 const result=await svc.pay(customer,'o',3,{});
 assert.equal(result.amountFen,5700);assert.equal(ledger.targetPeople,300);assert.ok(ledger.outTradeNo.length<=32);
 assert.equal(gatewayCalls[0].body.total_fee,5700);assert.equal(gatewayCalls[0].body.openid,'openid');
 assert.deepEqual(gatewayCalls[0].body.container,{service:'simu-api',path:'/api/exposure-pay/notify'});
 await svc.pay(customer,'o',1,{});assert.equal(gatewayCalls[1].body.total_fee,5700);
});
test('非本人、已关闭及定向需求不能购买曝光',async()=>{
 await assert.rejects(svc.pay({...customer,id:'other'},'o',1,{}),e=>e.status===409);
 order.status='CLOSED';await assert.rejects(svc.pay(customer,'o',1,{}),e=>e.status===409);
 order.status='QUOTING';direct=true;await assert.rejects(svc.pay(customer,'o',1,{}),e=>e.status===400);
 assert.equal(gatewayCalls.length,0);
});
test('真实查单核对金额、商户、AppID、单号、币种和流水号',async()=>{
 const valid={...gatewayResponse};
 for(const overrides of [{total_fee:1},{sub_mch_id:'other'},{sub_appid:'other'},{out_trade_no:'other'},{fee_type:'USD'},{transaction_id:''}]){
  gatewayResponse={...valid,...overrides};await assert.rejects(svc.reconcile('trade'),e=>e.status===409);assert.equal(ledger.paymentStatus,'PENDING');
 }
 gatewayResponse=valid;await svc.reconcile('trade');await svc.reconcile('trade');
 assert.equal(ledger.paymentStatus,'SUCCESS');assert.equal(order.status,'QUOTING');
 assert.equal(sqls.filter(s=>s.startsWith("UPDATE order_exposures SET paymentStatus='SUCCESS'")).length,1);
 await assert.rejects(svc.applySuccess('trade','other'),e=>e.status===409);
});
test('伪造成功回调不能绕过服务器查单，待支付不会开始推流',async()=>{
 gatewayResponse={trade_state:'NOTPAY'};
 const r=await call('POST','/api/exposure-pay/notify',{out_trade_no:'trade',trade_state:'SUCCESS',total_fee:1900,transaction_id:'fake'});
 assert.equal(r.status,500);assert.equal(ledger.paymentStatus,'PENDING');
 assert.equal(gatewayCalls[0].path,'/queryorder');
 assert.deepEqual((await call('GET','/api/home/exposures',{},engineer)).result.data.items,[]);
});
test('模拟支付只在mock配置可用，先下单再确认，成功回调可重试',async()=>{
 await assert.rejects(call('POST','/api/orders/o/exposure/mock-confirm'),e=>e.status===404);
 config.paymentMode='mock';await assert.rejects(call('POST','/api/orders/o/exposure/mock-confirm'),e=>e.status===404);
 await svc.pay(customer,'o',2,{});await call('POST','/api/orders/o/exposure/mock-confirm');await call('POST','/api/orders/o/exposure/mock-confirm');
 assert.equal(ledger.paymentStatus,'SUCCESS');assert.equal(ledger.paymentMode,'mock');assert.equal(gatewayCalls.length,0);
});
test('只有付费、可报价、非定向、本人未计数的需求进入工程师首页',async()=>{
 ledger.paymentStatus='SUCCESS';let r=await call('GET','/api/home/exposures',{},engineer);
 assert.equal(r.result.data.items[0].impressionToken,'token1');
 assert.ok(sqls.some(s=>s.includes("paymentStatus='SUCCESS'")&&s.includes('seenAt IS NULL')&&s.includes('NOT EXISTS')));
 for(const change of [()=>{order.status='IN_PROGRESS';},()=>{direct=true;},()=>{order.deletedAt='now';},()=>{ledger.deliveredPeople=100;},()=>{tokens.e1.seen=true;}]){
  order.status='QUOTING';order.deletedAt=null;direct=false;ledger.deliveredPeople=0;tokens.e1.seen=false;change();
  assert.deepEqual((await call('GET','/api/home/exposures',{},engineer)).result.data.items,[]);
 }
});
test('同一工程师重复上报不重复计数，无凭证、过期或冒用凭证不计数',async()=>{
 ledger.paymentStatus='SUCCESS';
 assert.equal((await svc.impressions(engineer,[{orderId:'o',token:'bad'}]))[0].counted,false);
 assert.equal((await svc.impressions({id:'stranger'},[{orderId:'o',token:'token1'}]))[0].counted,false);
 tokens.e1.expired=true;assert.equal((await svc.impressions(engineer,[{orderId:'o',token:'token1'}]))[0].counted,false);tokens.e1.expired=false;
 const results=await Promise.all(Array.from({length:8},()=>svc.impressions(engineer,[{orderId:'o',token:'token1'}])));
 assert.equal(results.filter(r=>r[0].counted).length,1);assert.equal(ledger.deliveredPeople,1);
});
test('最后一个名额并发计数不超限，订单暂停、未付费或本人展示不计数',async()=>{
 ledger.paymentStatus='SUCCESS';ledger.deliveredPeople=99;
 const results=await Promise.all(['e1','e2'].map(id=>svc.impressions({id},[{orderId:'o',token:tokens[id].token}])));
 assert.equal(results.filter(r=>r[0].counted).length,1);assert.equal(ledger.deliveredPeople,100);
 for(const mutate of [()=>{ledger.paymentStatus='PENDING';},()=>{order.status='IN_PROGRESS';},()=>{order.customerId='e1';},()=>{order.deletedAt='now';}]){
  ledger.deliveredPeople=0;ledger.paymentStatus='SUCCESS';order.status='QUOTING';order.customerId='c';order.deletedAt=null;tokens.e1.seen=false;mutate();
  assert.equal((await svc.impressions(engineer,[{orderId:'o',token:'token1'}]))[0].counted,false);assert.equal(ledger.deliveredPeople,0);
 }
});
test('进度仅本人可读，已支付订单区分进行、暂停和完成；待支付查单可补偿漏回调',async()=>{
 await assert.rejects(svc.read('o','other'),e=>e.status===404);
 assert.equal((await svc.read('o','c')).state,'UNPAID');
 ledger.paymentStartedAt='now';await svc.read('o','c');assert.equal(ledger.paymentStatus,'SUCCESS');
 ledger.deliveredPeople=37;let r=await svc.read('o','c');assert.equal(r.state,'ACTIVE');assert.equal(r.progress,37);
 order.status='IN_PROGRESS';assert.equal((await svc.read('o','c')).state,'PAUSED');
 ledger.deliveredPeople=100;assert.equal((await svc.read('o','c')).state,'COMPLETED');
});
test('上报接口要求已认证工程师，限制批量并校验展示凭证',async()=>{
 const url='/api/home/exposures/impressions',body={items:[{orderId:'o',token:'token1'}]};
 await assert.rejects(call('POST',url,body,customer),e=>e.status===403);
 await assert.rejects(call('POST',url,body,{...engineer,approved:false}),e=>e.status===403);
 await assert.rejects(call('POST',url,{items:[]},engineer),e=>e.status===400);
 await assert.rejects(call('POST',url,{items:Array(6).fill(body.items[0])},engineer),e=>e.status===400);
 await assert.rejects(call('POST',url,{items:[{orderId:'o'}]},engineer),e=>e.status===400);
});
