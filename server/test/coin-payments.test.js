'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{EventEmitter}=require('node:events');
const mock=(p,exports)=>require.cache[require.resolve(p)]={exports,loaded:true};
const config={env:'production',paymentMode:'wechat',wxpayMchid:'m',wxAppid:'app',cloudbaseEnv:'env',wxpayCallbackService:'svc',payTimeoutSec:1800};
let state,queue=Promise.resolve(),gateway,calls,delay,closeFail;
const copy=x=>x&&{...x};
async function execute(sql,a=[]){
 if(sql.startsWith('SELECT')){
  if(sql.includes('FROM users'))return [[{id:a[0],status:'ACTIVE'}]];
  if(sql.includes('FROM orders')){const o=state.orders[a[0]];return [[...(o&&(!sql.includes('customerId=?')||o.customerId===a[1])?[copy(o)]:[])]];}
  if(sql.includes('FROM direct_demands'))return [[]];
  if(sql.includes('FROM incentive_rewards'))return [[{amount:state.earned}]];
  if(sql.includes('FROM coin_refunds'))return [[...state.refunds.filter(r=>r.businessKey===a[0]).map(copy)]];
  if(sql.includes('FROM coin_spends s JOIN payments'))return [[...Object.values(state.spends).filter(s=>s.orderId===a[0]&&s.status==='SPENT'&&s.kind==='ORDER').map(s=>({...s,gross:Object.values(state.payments).find(p=>'ORDER:'+p.outTradeNo===s.businessKey)?.grossAmountFen}))]];
  if(sql.includes('FROM coin_spends'))return [[...Object.values(state.spends).filter(s=>sql.includes('businessKey=?')?s.businessKey===a[0]:s.userId===a[0]&&['HELD','SPENT'].includes(s.status)).map(copy)]];
  if(sql.includes('FROM order_exposures'))return [[...(state.exposure?[copy(state.exposure)]:[])]];
  if(sql.startsWith('SELECT orderId FROM payments'))return [[...Object.values(state.payments).filter(p=>p.outTradeNo===a[0]).map(copy)]];
  if(sql.includes('FROM payments'))return [[...Object.values(state.payments).filter(p=>sql.includes('outTradeNo=?')?p.outTradeNo===a[0]:p.orderId===a[0]&&(sql.includes("status IN ('PENDING','SUCCESS')")?['PENDING','SUCCESS'].includes(p.status):p.status==='PENDING')&&(!sql.includes('COALESCE')||Number(p.grossAmountFen??p.amountFen)===a[1])).map(copy)]];
 }
 if(sql.startsWith('INSERT INTO coin_spends')){const [businessKey,userId,kind,orderId,coins]=a;state.spends[businessKey]={businessKey,userId,kind,orderId,coins,status:'HELD',refundedCoins:0};}
 else if(sql.startsWith('UPDATE coin_spends SET status=')){const s=state.spends[a[0]],valid=s?.status==='HELD'&&(!sql.includes('coins=?')||s.coins===a[1]);if(valid)s.status=sql.includes("'SPENT'")?'SPENT':'RELEASED';return [{affectedRows:valid?1:0}];}
 else if(sql.startsWith('UPDATE coin_spends SET refundedCoins'))state.spends[a[1]].refundedCoins+=a[0];
 else if(sql.startsWith('INSERT INTO coin_refunds'))state.refunds.push({businessKey:a[0],paymentKey:a[1],userId:a[2],coins:a[3]});
 else if(sql.startsWith('INSERT INTO payments')){const [id,orderId,outTradeNo,amountFen]=a;state.payments[outTradeNo]={id,orderId,outTradeNo,amountFen,grossAmountFen:sql.includes('grossAmountFen')?a[4]:null,coinAmount:sql.includes('coinAmount')?a[5]:0,status:'PENDING'};}
 else if(sql.startsWith("UPDATE payments SET status='SUCCESS'")){const p=Object.values(state.payments).find(p=>p.id===a[3]);p.status='SUCCESS';p.transactionId=a[0];}
 else if(sql.startsWith("UPDATE payments SET status='FAILED'")){for(const p of Object.values(state.payments))if(sql.includes('WHERE orderId=?')?p.orderId===a[0]:p.outTradeNo===a[0])p.status='FAILED';}
 else if(sql.startsWith("UPDATE orders SET status='IN_PROGRESS'")){const o=state.orders[a[2]],valid=o.status==='AWAITING_PAYMENT'&&a[3]===1;if(valid)o.status='IN_PROGRESS';return [{affectedRows:valid?1:0}];}
 else if(sql.startsWith("UPDATE orders SET status='QUOTING'"))Object.assign(state.orders[a[1]],{status:'QUOTING',selectedQuoteId:null,finalAmountFen:null});
 else if(sql.startsWith('UPDATE quotes')){}
 else if(sql.startsWith('UPDATE order_exposures SET targetPeople'))Object.assign(state.exposure,{targetPeople:a[0],amountFen:a[1],paymentStartedAt:new Date(),paymentMode:a[2],provider:a[3]});
 else if(sql.startsWith('UPDATE order_exposures SET cashAmountFen'))Object.assign(state.exposure,{cashAmountFen:a[0],coinAmount:a[1]});
 else if(sql.startsWith('UPDATE order_exposures SET outTradeNo'))Object.assign(state.exposure,{outTradeNo:a[0],paymentStartedAt:null,cashAmountFen:null,coinAmount:0});
 else if(sql.startsWith("UPDATE order_exposures SET paymentStatus='SUCCESS'"))Object.assign(state.exposure,{paymentStatus:'SUCCESS',transactionId:a[0],paymentMode:a[1]});
 else if(sql.startsWith('UPDATE orders SET promotion'))state.orders[a[0]].promotion='EXPOSURE';
 else throw Error('Unexpected SQL: '+sql);
 return [{affectedRows:1}];
}
const db={tx:fn=>{const run=queue.then(async()=>{const snapshot=structuredClone(state);try{return await fn({execute});}catch(e){state=snapshot;throw e;}});queue=run.catch(()=>{});return run;},query:async(sql,a)=>{
 if(sql.includes('SELECT id, selectedQuoteId FROM orders'))return Object.values(state.orders).filter(o=>o.status==='AWAITING_PAYMENT'&&o.selectedAt==='expired').map(copy);
 if(sql.startsWith('SELECT (SELECT')){const spends=Object.values(state.spends);return [{earned:state.earned,used:spends.filter(s=>s.status==='SPENT').reduce((n,s)=>n+s.coins-s.refundedCoins,0),frozen:spends.filter(s=>s.status==='HELD').reduce((n,s)=>n+s.coins,0)}];}
 return (await execute(sql,a))[0];
},queryOne:async(sql,a)=>(await db.query(sql,a))[0]||null};
mock('../src/config',{config});mock('../src/db',db);
mock('../src/services/chat-svc',{ensureConversation:async()=>({id:'conv'}),systemMessage:async()=>({msgId:'msg'}),publishConversationDoc(){},publishSystemMessage(){}});
http.request=(options,callback)=>{const req=new EventEmitter();let data='';req.setTimeout=()=>req;req.write=s=>data+=s;req.end=()=>{
 const body=JSON.parse(data),path=options.path;calls.push({path,body});
 const respond=()=>{let result={return_code:'SUCCESS',result_code:'SUCCESS'};
 if(path.endsWith('unifiedorder')){gateway[body.out_trade_no]={total:body.total_fee,state:'NOTPAY'};result.payment={timeStamp:'1',nonceStr:'n',package:'prepay_id=p',paySign:'sig'};}
 else if(path.endsWith('closeorder')){if(closeFail)result={return_code:'FAIL'};else gateway[body.out_trade_no].state='CLOSED';}
 else{const trade=gateway[body.out_trade_no];result=trade?{...result,trade_state:trade.state,out_trade_no:body.out_trade_no,sub_appid:'app',sub_mch_id:'m',total_fee:trade.total,transaction_id:'wx-'+body.out_trade_no}:{return_code:'SUCCESS',result_code:'FAIL',err_code:'ORDERNOTEXIST'};}
 const res=new EventEmitter();res.statusCode=200;callback(res);res.emit('data',JSON.stringify(result));res.emit('end');};
 if(delay&&path.endsWith('unifiedorder')){delay.started();delay.release=respond;}else respond();
 };return req;};
const coin=require('../src/services/coin-svc'),pay=require('../src/services/pay-svc'),exposure=require('../src/services/exposure-svc');
beforeEach(()=>{config.paymentMode='wechat';state={earned:2500,spends:{},refunds:[],payments:{},orders:{o:{id:'o',customerId:'c',status:'AWAITING_PAYMENT',selectedQuoteId:'q',finalAmountFen:10000},o2:{id:'o2',customerId:'c',status:'AWAITING_PAYMENT',selectedQuoteId:'q2',finalAmountFen:10000},exp:{id:'exp',customerId:'c',status:'QUOTING'}},exposure:{orderId:'exp',customerId:'c',targetPeople:100,deliveredPeople:0,amountFen:1900,outTradeNo:'ex-trade',paymentStatus:'PENDING'}};gateway={};calls=[];delay=null;closeFail=false;});
const customer={id:'c',openid:'openid'};
test('真实退款按计划返币，重复通知仅返一次，不能超退或返还未消费抵扣',async()=>{
 const p=await pay.createJsapiOrder(state.orders.o,'openid',{coins:1000});gateway[p.outTradeNo].state='SUCCESS';await pay.reconcilePayment(p.outTradeNo);
 await db.tx(c=>coin.refundExact(c,'ORDER:'+p.outTradeNo,'REFUND:cash1',333));
 await db.tx(c=>coin.refundExact(c,'ORDER:'+p.outTradeNo,'REFUND:cash1',333));
 assert.equal(state.spends['ORDER:'+p.outTradeNo].refundedCoins,333);assert.equal(state.refunds.length,1);
 await assert.rejects(db.tx(c=>coin.refundExact(c,'ORDER:'+p.outTradeNo,'REFUND:cash2',668)),e=>e.status===409);
 await db.tx(c=>coin.refundExact(c,'ORDER:'+p.outTradeNo,'REFUND:cash2',667));assert.equal(state.spends['ORDER:'+p.outTradeNo].refundedCoins,1000);
 await assert.rejects(db.tx(c=>coin.refundExact(c,'ORDER:'+p.outTradeNo,'REFUND:cash1',334)),e=>e.status===409);
});
test('每币对应一分：抵扣1000币时现金支付90元，总服务金额仍100元',async()=>{
 const p=await pay.createJsapiOrder(state.orders.o,'openid',{coins:1000});assert.equal(p.amountFen,9000);assert.equal(p.grossAmountFen,10000);assert.equal(calls[0].body.total_fee,9000);assert.equal((await coin.totals('c')).frozen,1000);
 gateway[p.outTradeNo].state='SUCCESS';await pay.reconcilePayment(p.outTradeNo);await pay.reconcilePayment(p.outTradeNo);
 assert.equal((await coin.totals('c')).balance,1500);assert.equal((await coin.totals('c')).used,1000);assert.equal(state.orders.o.status,'IN_PROGRESS');
});
test('同一支付单重试不重复冻结，改变抵扣额需取消旧单',async()=>{
 const first=await pay.createPayment(state.orders.o,{coins:500}),again=await pay.createPayment(state.orders.o,{coins:500});assert.equal(first.outTradeNo,again.outTradeNo);assert.equal(Object.keys(state.spends).length,1);
 await assert.rejects(pay.createPayment(state.orders.o,{coins:1000}),e=>e.status===409);
});
test('余额不足、超额、负数与非整数不能创建支付或冻结',async()=>{
 for(const coins of [2501,10001,-1,1.5])await assert.rejects(pay.createPayment(state.orders.o,{coins}));assert.equal(Object.keys(state.payments).length,0);assert.equal((await coin.totals('c')).balance,2500);
});
test('同一用户并发抵扣两个订单只能成功一笔，防止重复花费',async()=>{
 const results=await Promise.allSettled([pay.createPayment(state.orders.o,{coins:2000}),pay.createPayment(state.orders.o2,{coins:2000})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await coin.totals('c')).balance,500);
});
test('全额仿真币支付直接完成，不向微信创建0元支付单',async()=>{
 state.orders.o.finalAmountFen=1000;const result=await pay.createJsapiOrder(state.orders.o,'',{coins:1000});assert.equal(result.mode,'coins');assert.equal(result.amountFen,0);assert.equal(calls.length,0);assert.equal(state.orders.o.status,'IN_PROGRESS');assert.equal((await coin.totals('c')).used,1000);
});
test('真实支付取消先关单再释放，关单失败保留冻结；已支付不能释放',async()=>{
 const p=await pay.createJsapiOrder(state.orders.o,'openid',{coins:1000});closeFail=true;await assert.rejects(pay.cancelPayment('o','c'));assert.equal((await coin.totals('c')).frozen,1000);
 closeFail=false;gateway[p.outTradeNo].state='SUCCESS';assert.equal((await pay.cancelPayment('o','c')).paid,true);assert.equal((await coin.totals('c')).used,1000);
});
test('取消未付订单释放一次，其他用户不可取消；再次支付用新单号',async()=>{
 const p=await pay.createJsapiOrder(state.orders.o,'openid',{coins:1000});await assert.rejects(pay.cancelPayment('o','other'),e=>e.status===404);
 await pay.cancelPayment('o','c');await pay.cancelPayment('o','c');assert.equal(gateway[p.outTradeNo].state,'CLOSED');assert.equal((await coin.totals('c')).balance,2500);
 const next=await pay.createPayment(state.orders.o,{coins:500});assert.notEqual(next.outTradeNo,p.outTradeNo);
});
test('网关下单未完成时取消等待订单锁，不提前释放仿真币',async()=>{
 let started;const ready=new Promise(resolve=>started=resolve);delay={started};const pending=pay.createJsapiOrder(state.orders.o,'openid',{coins:1000});await ready;
 const cancelled=pay.cancelPayment('o','c');await new Promise(resolve=>setImmediate(resolve));assert.equal((await coin.totals('c')).frozen,1000);assert.equal(calls.length,1);
 delay.release();await pending;await cancelled;assert.equal((await coin.totals('c')).balance,2500);assert.equal(calls[1].path,'/_/pay/queryorder');
});
test('曝光抵扣仅支付现金差额，全额抵扣也开始曝光',async()=>{
 const partial=await exposure.pay(customer,'exp',1,{coins:900});assert.equal(partial.amountFen,1000);assert.equal(calls[0].body.total_fee,1000);await exposure.cancel(customer,'exp');assert.equal((await coin.totals('c')).balance,2500);
 const full=await exposure.pay(customer,'exp',1,{coins:1900});assert.equal(full.mode,'coins');assert.equal(state.exposure.paymentStatus,'SUCCESS');assert.equal(state.orders.exp.promotion,'EXPOSURE');assert.equal((await coin.totals('c')).used,1900);
});
test('退款按抵扣比例退币，同一退款登记重复处理不重复返还',async()=>{
 config.paymentMode='mock';const p=await pay.createPayment(state.orders.o,{coins:1000});await pay.applyPaymentSuccess(p.outTradeNo,'mock',{mock:true});
 await db.tx(c=>coin.refund(c,'o','partial',5000));await db.tx(c=>coin.refund(c,'o','partial',5000));assert.equal((await coin.totals('c')).used,500);assert.equal(state.refunds.length,1);
 await db.tx(c=>coin.refund(c,'o','full'));assert.equal((await coin.totals('c')).balance,2500);assert.equal(state.refunds.reduce((n,r)=>n+r.coins,0),1000);
});
test('模拟待支付订单超时回退报价，并释放本单冻结仿真币',async()=>{
 config.paymentMode='mock';await pay.createPayment(state.orders.o,{coins:1000});state.orders.o.selectedAt='expired';assert.equal(await pay.sweepExpiredAwaitingPayment(),1);assert.equal(state.orders.o.status,'QUOTING');assert.equal((await coin.totals('c')).balance,2500);assert.equal(Object.values(state.payments)[0].status,'FAILED');
});
test('曝光真实查单按现金差额核验，重复成功不重复扣币',async()=>{
 await exposure.pay(customer,'exp',1,{coins:900});gateway['ex-trade'].state='SUCCESS';await exposure.reconcile('ex-trade');await exposure.reconcile('ex-trade');assert.equal((await coin.totals('c')).used,900);assert.equal(state.exposure.paymentStatus,'SUCCESS');
});
test('曝光网关未建单时仍返回待支付状态和取消入口，不误记成功',async()=>{
 await exposure.pay(customer,'exp',1,{coins:900});delete gateway['ex-trade'];const view=await exposure.read('exp','c');assert.equal(view.state,'UNPAID');assert.equal(view.paymentStarted,true);assert.match(view.paymentNotice,/待确认/);assert.equal((await coin.totals('c')).frozen,900);
 await exposure.cancel(customer,'exp');assert.equal((await coin.totals('c')).balance,2500);
});
