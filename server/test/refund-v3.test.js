'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>require.cache[require.resolve(p)]={exports,loaded:true};
let state,apiCalls,apiError,apiStatus,coinFail,queue=Promise.resolve();
const copy=x=>x&&{...x};
async function execute(sql,a=[]){
 if(sql.startsWith('SELECT')){
  if(sql.includes('FROM orders'))return [[{id:'o'}]];
  if(sql.includes('FROM disputes'))return [[copy(state.dispute)]];
  if(sql.includes('FROM refund_requests'))return [[copy(state.agreed)]];
  if(sql.includes('FROM payments'))return [[copy(state.payment)]];
  if(sql.includes('FROM payment_refunds'))return [[...state.refunds.filter(r=>sql.includes('paymentId=?')?r.paymentId===a[0]:sql.includes('outRefundNo=?')?r.outRefundNo===a[0]:r.id===a[0]).map(copy)]];
 }
 if(sql.startsWith('INSERT INTO payment_refunds')){
  const [id,businessKey,orderId,paymentId,outTradeNo,outRefundNo,sourceType,sourceId,grossRefundFen,cashRefundFen,coinRefund,totalCashFen,transactionId]=a;
  assert.ok(!state.refunds.some(r=>r.businessKey===businessKey));state.refunds.push({id,businessKey,orderId,paymentId,outTradeNo,outRefundNo,sourceType,sourceId,grossRefundFen,cashRefundFen,coinRefund,totalCashFen,transactionId,status:'PENDING'});
 }else if(sql.startsWith('UPDATE payment_refunds SET status=')){const r=state.refunds.find(r=>r.id===a[2]);Object.assign(r,{status:a[0],refundId:a[1],lastError:null});}
 else if(sql.startsWith('UPDATE payment_refunds SET lastError=')){state.refunds.find(r=>r.id===a[1]).lastError=a[0];}
 else if(sql.startsWith("UPDATE disputes SET refundStatus='PROCESSED'"))Object.assign(state.dispute,{refundStatus:'PROCESSED',refundTransactionId:a[0]});
 else if(sql.startsWith('UPDATE disputes SET refundStatus='))state.dispute.refundStatus=a[0];
 else throw Error('Unexpected SQL: '+sql);
 return [{affectedRows:1}];
}
mock('../src/config',{config:{paymentMode:'wechat'}});
mock('../src/db',{queryOne:async(sql,a)=>(await execute(sql,a))[0][0]||null,query:async(sql,a)=>(await execute(sql,a))[0],
 tx:fn=>{const run=queue.then(async()=>{const before=structuredClone(state);try{return await fn({execute});}catch(e){state=before;throw e;}});queue=run.catch(()=>{});return run;}});
mock('../src/services/coin-svc',{refundExact:async(c,key,businessKey,coins)=>{if(coinFail)throw Error('coin write failed');assert.equal(key,'ORDER:trade_123456');state.coinCalls.push({businessKey,coins});}});
mock('../src/services/wechat-pay-v3',{notifyUrl:p=>'https://pay.example.com'+p,result:r=>r.body,
 request:async(method,path,body)=>{
  apiCalls.push({method,path,body});if(apiError)throw Error('network timeout');
  const r=state.refunds.find(r=>method==='POST'?r.outRefundNo===body.out_refund_no:path.endsWith(r.outRefundNo));
  return {status:200,body:{status:apiStatus,out_refund_no:r.outRefundNo,out_trade_no:r.outTradeNo,transaction_id:r.transactionId,refund_id:'wxrefund',amount:{total:r.totalCashFen,refund:r.cashRefundFen,currency:'CNY'}}};
 }});
const svc=require('../src/services/refund-svc');
beforeEach(()=>{state={payment:{id:'p',orderId:'o',provider:'v3',status:'SUCCESS',amountFen:9000,grossAmountFen:10000,coinAmount:1000,transactionId:'wxpay',outTradeNo:'trade_123456'},agreed:{id:'rr',orderId:'o',status:'AGREED'},dispute:{id:'d',orderId:'o',status:'RESOLVED',refundStatus:'PENDING',refundAmountFen:5000},refunds:[],coinCalls:[]};apiCalls=[];apiError=false;coinFail=false;apiStatus='PROCESSING';});
test('全额和部分原路退款仅退实收现金、按比例返币，处理中的退款保留额度',()=>{
 assert.deepEqual(svc.plan(state.payment,[],null),{grossRefundFen:10000,cashRefundFen:9000,coinRefund:1000,totalCashFen:9000});
 const first=svc.plan(state.payment,[],5000);assert.equal(first.cashRefundFen,4500);assert.equal(first.coinRefund,500);
 const next=svc.plan(state.payment,[{...first,status:'PROCESSING'}],null);assert.equal(next.cashRefundFen,4500);assert.equal(next.coinRefund,500);
 assert.throws(()=>svc.plan(state.payment,[{...first,status:'PENDING'}],6000),e=>e.status===409);
 assert.throws(()=>svc.plan({...state.payment,amountFen:9999},[],100),e=>e.status===409);
});
test('分次退款尾差分配到最后一笔，大金额采用整数运算',()=>{
 const p={amountFen:2,grossAmountFen:3,coinAmount:1},prior=[];
 for(let i=0;i<3;i++)prior.push({...svc.plan(p,prior,1),status:'SUCCESS'});
 assert.equal(prior.reduce((s,r)=>s+r.coinRefund,0),1);assert.equal(prior.reduce((s,r)=>s+r.cashRefundFen,0),2);
 const big={amountFen:1,grossAmountFen:1000000000,coinAmount:999999999};assert.equal(svc.plan(big,[],999999999).coinRefund,999999998);
});
test('并发申请和超时重试共用唯一退款单，不提前返币；查单成功仅返还一次',async()=>{
 apiError=true;const attempts=await Promise.allSettled([svc.request('AGREED','rr'),svc.request('AGREED','rr')]);
 assert.ok(attempts.every(r=>r.status==='rejected'));assert.equal(state.refunds.length,1);assert.equal(new Set(apiCalls.map(c=>c.body.out_refund_no)).size,1);assert.equal(state.coinCalls.length,0);
 assert.equal(apiCalls[0].body.amount.refund,9000);assert.equal(apiCalls[0].body.amount.total,9000);assert.match(apiCalls[0].body.notify_url,/\/api\/pay\/v3\/refund-notify$/);
 apiError=false;await svc.request('AGREED','rr');assert.equal(state.refunds[0].status,'PROCESSING');assert.equal(state.coinCalls.length,0);
 apiStatus='SUCCESS';await Promise.all([svc.reconcile(state.refunds[0].outRefundNo),svc.reconcile(state.refunds[0].outRefundNo)]);
 assert.equal(state.refunds[0].status,'SUCCESS');assert.equal(state.coinCalls.length,1);assert.equal(state.coinCalls[0].coins,1000);assert.equal(apiCalls.at(-1).method,'GET');
});
test('纠纷退款待微信确认，成功才更新PROCESSED，异常不可记作成功',async()=>{
 await svc.request('DISPUTE','d');assert.equal(state.dispute.refundStatus,'PENDING');assert.equal(state.refunds[0].cashRefundFen,4500);
 apiStatus='ABNORMAL';await svc.request('DISPUTE','d');assert.equal(state.dispute.refundStatus,'FAILED');assert.equal(state.coinCalls.length,0);
 apiStatus='SUCCESS';await svc.request('DISPUTE','d');assert.equal(state.dispute.refundStatus,'PROCESSED');assert.equal(state.dispute.refundTransactionId,'wxrefund');assert.equal(state.coinCalls[0].coins,500);
});
test('全额仿真币退款不请求微信0元退款接口',async()=>{
 Object.assign(state.payment,{amountFen:0,grossAmountFen:1000,coinAmount:1000,transactionId:'COINS_trade_123456'});
 await svc.request('AGREED','rr');assert.equal(apiCalls.length,0);assert.equal(state.refunds[0].status,'SUCCESS');assert.equal(state.coinCalls[0].coins,1000);
});
test('未批准、历史通道及已手工处理的历史退款不可再次提交现金退款',async()=>{
 state.agreed.status='PENDING';await assert.rejects(svc.request('AGREED','rr'),e=>e.status===409);
 state.agreed.status='AGREED';state.payment.provider='cloudbase';await assert.rejects(svc.request('AGREED','rr'),e=>e.status===409);
 state.payment.provider='v3';state.dispute.refundStatus='PROCESSED';await assert.rejects(svc.request('DISPUTE','d'),e=>e.status===409);assert.equal(apiCalls.length,0);
});
test('拒绝错误退款金额、币种、流水号和单号；返币写入失败会整体回滚可重试',async()=>{
 const r=await svc.prepare('DISPUTE','d'),valid={status:'SUCCESS',out_refund_no:r.outRefundNo,out_trade_no:r.outTradeNo,transaction_id:r.transactionId,refund_id:'wxrefund',amount:{total:9000,refund:4500,currency:'CNY'}};
 for(const bad of [{...valid,out_trade_no:'other'},{...valid,transaction_id:'other'},{...valid,out_refund_no:'other'},{...valid,refund_id:''},{...valid,amount:{total:9000,refund:5000,currency:'CNY'}},{...valid,amount:{total:9000,refund:4500,currency:'USD'}}])await assert.rejects(svc.apply(r,bad),e=>e.status===409);
 assert.equal(state.coinCalls.length,0);coinFail=true;await assert.rejects(svc.apply(r,valid));assert.equal(state.refunds[0].status,'PENDING');assert.equal(state.dispute.refundStatus,'PENDING');
 coinFail=false;await svc.apply(r,valid);await svc.apply(r,{...valid,status:'PROCESSING'});assert.equal(state.refunds[0].status,'SUCCESS');assert.equal(state.coinCalls.length,1);
});
