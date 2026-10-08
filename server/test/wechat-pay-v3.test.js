'use strict';
const {test,beforeEach}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto'),https=require('node:https');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const pair=()=>crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const merchant=pair(),wechat=pair();
const config={paymentMode:'wechat',wxpayTransport:'v3',wxpayMchid:'1900000109',wxAppid:'wx1234567890123456',
 wxpaySerialNo:'1234ABCD',wxpayPublicKeyId:'PUB_KEY_ID_TEST_1234',wxpayApiV3Key:'12345678901234567890123456789012',
 wxpayNotifyBaseUrl:'https://pay.example.com',wxpayPrivateKeyBase64:Buffer.from(merchant.privateKey.export({type:'pkcs8',format:'pem'})).toString('base64'),
 wxpayPublicKeyBase64:Buffer.from(wechat.publicKey.export({type:'spki',format:'pem'})).toString('base64')};
const mock=(p,exports)=>require.cache[require.resolve(p)]={exports,loaded:true};
mock('../src/config',{config});
let reply,calls,tamper,unsigned,state,recordProvider,notifyCalls;
function signed(raw,overrides={}){
 const timestamp=String(Math.floor(Date.now()/1000)),nonce='reply-nonce';
 return {'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':config.wxpayPublicKeyId,
  'wechatpay-signature':crypto.sign('RSA-SHA256',Buffer.concat([Buffer.from(`${timestamp}\n${nonce}\n`),Buffer.from(raw),Buffer.from('\n')]),wechat.privateKey).toString('base64'),...overrides};
}
https.request=(opts,cb)=>{
 const req=new EventEmitter();req.setTimeout=()=>req;req.destroy=e=>req.emit('error',e);
 req.end=raw=>{
  calls.push({...opts,raw});
  const auth=Object.fromEntries([...opts.headers.Authorization.matchAll(/([a-z_]+)="([^"]+)"/g)].map(m=>[m[1],m[2]]));
  assert.equal(auth.mchid,config.wxpayMchid);assert.equal(opts.hostname,'api.mch.weixin.qq.com');
  assert.ok(crypto.verify('RSA-SHA256',Buffer.from(`${opts.method}\n${opts.path}\n${auth.timestamp}\n${auth.nonce_str}\n${raw}\n`),merchant.publicKey,Buffer.from(auth.signature,'base64')));
  const res=new EventEmitter();res.statusCode=reply.status;
  const bytes=reply.status===204?'':JSON.stringify(reply.body);res.headers=unsigned?{}:signed(bytes);cb(res);
  res.emit('data',Buffer.from(tamper?bytes+' ':bytes));res.emit('end');
 };return req;
};
mock('../src/db',{queryOne:async()=>({provider:recordProvider})});
mock('../src/services/pay-svc',{reconcilePayment:async()=>{notifyCalls++;return state;}});
mock('../src/services/exposure-svc',{reconcile:async()=>{notifyCalls++;return {paid:state.reason!=='not-paid'};}});
mock('../src/services/refund-svc',{reconcile:async()=>{notifyCalls++;return {status:'SUCCESS'};}});
const svc=require('../src/services/wechat-pay-v3');
const notification=require('../src/services/payment-notify-v3');
beforeEach(()=>{reply={status:200,body:{prepay_id:'wx-prepay-id'}};calls=[];tamper=false;unsigned=false;state={applied:true};recordProvider='v3';notifyCalls=0;});
const trade='trade_123456';
test('普通商户下单使用v3 HTTPS和商户签名；小程序支付参数为RSA，回调使用公网地址',async()=>{
 const r=await svc.gateway('/unifiedorder',{out_trade_no:trade,total_fee:9000,openid:'wx-openid',body:'仿真服务'});
 const b=JSON.parse(calls[0].raw);assert.equal(calls[0].path,'/v3/pay/transactions/jsapi');
 assert.deepEqual(b.amount,{total:9000,currency:'CNY'});assert.deepEqual(b.payer,{openid:'wx-openid'});
 assert.equal(b.mchid,config.wxpayMchid);assert.equal(b.notify_url,'https://pay.example.com/api/pay/v3/notify');assert.equal(b.settle_info,undefined);
 const p=r.body.payment;assert.equal(p.signType,'RSA');
 assert.ok(crypto.verify('RSA-SHA256',Buffer.from(`${config.wxAppid}\n${p.timeStamp}\n${p.nonceStr}\n${p.package}\n`),merchant.publicKey,Buffer.from(p.paySign,'base64')));
 await svc.gateway('/unifiedorder',{out_trade_no:trade,total_fee:1900,openid:'wx-openid',body:'需求曝光',container:{path:'/api/exposure-pay/notify'}});
 assert.equal(JSON.parse(calls[1].raw).notify_url,'https://pay.example.com/api/exposure-pay/v3/notify');
});
test('查单使用GET和商户号，204关单按空报文验签，仅明确404不存在才允许取消',async()=>{
 reply={status:200,body:{out_trade_no:trade,mchid:config.wxpayMchid,appid:config.wxAppid,trade_state:'SUCCESS',amount:{total:9000,currency:'CNY'}}};
 const q=await svc.gateway('/queryorder',{out_trade_no:trade});assert.equal(q.body.total_fee,9000);assert.equal(q.body.mch_id,config.wxpayMchid);
 assert.equal(calls[0].method,'GET');assert.match(calls[0].path,/\?mchid=1900000109$/);assert.equal(calls[0].raw,'');
 reply={status:204};await svc.gateway('/closeorder',{out_trade_no:trade});assert.equal(calls[1].method,'POST');assert.match(calls[1].path,/\/close$/);
 reply={status:404,body:{code:'ORDER_NOT_EXIST'}};assert.equal((await svc.gateway('/queryorder',{out_trade_no:trade})).body.err_code,'ORDERNOTEXIST');
 unsigned=true;assert.equal((await svc.gateway('/queryorder',{out_trade_no:trade})).body.err_code,'ORDERNOTEXIST');
 reply={status:500,body:{code:'SYSTEM_ERROR'}};await assert.rejects(svc.gateway('/queryorder',{out_trade_no:trade}),e=>e.status===400);
});
test('拒绝篡改响应、未知公钥、过期时间戳、签名探测和不带签名的成功响应',async()=>{
 tamper=true;await assert.rejects(svc.request('POST','/v3/pay/transactions/jsapi',{}),e=>e.status===403);
 const body=Buffer.from('{"prepay_id":"ok"}');
 for(const overrides of [{'wechatpay-serial':'PUB_KEY_ID_OTHER'},{'wechatpay-timestamp':'1000000000'},{'wechatpay-signature':'WECHATPAY/SIGNTEST/test'}])assert.throws(()=>svc.verify(signed(body,overrides),body),e=>e.status===403);
 tamper=false;unsigned=true;await assert.rejects(svc.request('GET','/v3/certificates'),e=>e.status===403);
});
function envelope(data={appid:config.wxAppid,mchid:config.wxpayMchid,trade_state:'SUCCESS',out_trade_no:trade},eventType='TRANSACTION.SUCCESS'){
 const cipher=crypto.createCipheriv('aes-256-gcm',Buffer.from(config.wxpayApiV3Key),Buffer.from('123456789012'));
 cipher.setAAD(Buffer.from('transaction'));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(data)),cipher.final(),cipher.getAuthTag()]).toString('base64');
 const raw=Buffer.from(JSON.stringify({id:'event-1',event_type:eventType,resource_type:'encrypt-resource',resource:{algorithm:'AEAD_AES_256_GCM',original_type:'transaction',nonce:'123456789012',associated_data:'transaction',ciphertext}}));
 return {raw,headers:signed(raw)};
}
async function notify(kind,e){const req=Readable.from([e.raw]);req.headers=e.headers;let status,body;await notification.handler(kind)(req,{writeHead:s=>status=s,end:b=>body=b});return {status,body};}
test('回调原始字节验签并AES-GCM解密；普通单和曝光查单落账后返回204，重复事件安全',async()=>{
 const e=envelope();assert.equal(svc.decryptNotification(e.headers,e.raw).data.out_trade_no,trade);
 assert.equal((await notify('order',e)).status,204);assert.equal((await notify('order',e)).status,204);assert.equal(notifyCalls,2);
 assert.equal((await notify('exposure',e)).status,204);
 state={reason:'not-paid'};assert.equal((await notify('order',e)).status,500);
});
test('无签名、跨商户、跨AppID、无效GCM、错误事件和错通道通知不能调用落账',async()=>{
 const e=envelope();assert.equal((await notify('order',{...e,headers:{}})).status,401);
 assert.equal((await notify('order',envelope({mchid:'other',appid:config.wxAppid,trade_state:'SUCCESS'}))).status,401);
 assert.equal((await notify('order',envelope({mchid:config.wxpayMchid,appid:'other',trade_state:'SUCCESS'}))).status,400);
 const modified=JSON.parse(e.raw);modified.resource.associated_data='tampered';const raw=Buffer.from(JSON.stringify(modified));
 assert.equal((await notify('order',{raw,headers:signed(raw)})).status,401);
 assert.equal((await notify('order',envelope(undefined,'REFUND.SUCCESS'))).status,400);
 recordProvider='cloudbase';assert.equal((await notify('order',e)).status,500);assert.equal(notifyCalls,0);
});
test('不完整密钥配置、HTTP或带路径回调地址不发起支付请求',()=>{
 const key=config.wxpayApiV3Key;config.wxpayApiV3Key='invalid';assert.throws(()=>svc.assertConfigured(),e=>e.status===409);config.wxpayApiV3Key=key;
 const base=config.wxpayNotifyBaseUrl;for(const url of ['http://pay.example.com','https://pay.example.com/api','https://pay.example.com/?a=1']){config.wxpayNotifyBaseUrl=url;assert.throws(()=>svc.assertConfigured(),e=>e.status===409);}config.wxpayNotifyBaseUrl=base;
 assert.equal(calls.length,0);
});
