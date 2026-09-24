'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={loaded:true,exports};};
let attempts=0,pending=false,created=0;
mock('../src/db',{
 queryOne:async()=>null,query:async()=>[],parseJson:x=>x,
 tx:async fn=>fn({execute:async(sql,args)=>{
  if(sql.includes('SELECT o.*, q.engineerId'))return [[{id:'o',status:'IN_PROGRESS',engineerId:'e'}]];
  if(sql.includes('SELECT id FROM refund_requests')){assert.ok(!sql.includes('REJECTED'));return [pending?[{id:'pending'}]:[]];}
  if(sql.startsWith('SELECT COUNT(*) n FROM refund_requests'))return [[{n:attempts}]];
  if(sql.includes('SELECT id FROM disputes'))return [[]];
  if(sql.startsWith('UPDATE orders'))return [{affectedRows:1}];
  if(sql.includes('INSERT INTO refund_requests')){assert.equal(args.at(-1),'其他');created++;return [{}];}
  throw Error(sql);
 }})
});
mock('../src/lib/auth-mw',{requireCustomer:async()=>({id:'c'})});
mock('../src/services/chat-svc',{systemMessageForOrder:async()=>{}});
mock('../src/services/pay-svc',{});mock('../src/services/engineer-level',{});
const {createRouter}=require('../src/lib/http');const router=createRouter();require('../src/routes/orders').register(router);
async function refund(body={reasonType:'其他',reason:'需要变更项目',fileIds:[]}){
 const req=Readable.from([Buffer.from(JSON.stringify(body))]);let data;
 await router.match('POST','/api/orders/o/refund-request').handler(req,{writeHead(){},end(s){data=JSON.parse(s).data;}},{id:'o'});return data;
}
test('三次退款额度：拒绝后可重试，第四次拒绝；未处理申请不可重复',async()=>{
 for(attempts=0;attempts<3;attempts++){const result=await refund();assert.equal(result.status,'PENDING');assert.equal(result.remainingAttempts,2-attempts);}
 assert.equal(created,3);await assert.rejects(refund(),/已达3次/);
 attempts=1;pending=true;await assert.rejects(refund(),/待处理/);pending=false;
 await assert.rejects(refund({reasonType:'伪造',reason:'原因'}),e=>e.status===400);
 await assert.rejects(refund({reasonType:'其他',reason:''}),e=>e.status===400);
});
test('普票、专票和数电票按类型验证资料',()=>{
 const {invoiceDetails}=require('../src/services/invoice-details');
 assert.equal(invoiceDetails({},null).buyer,'PERSONAL');
 assert.throws(()=>invoiceDetails({buyerType:'BUSINESS'},null),/纳税人/);
 assert.throws(()=>invoiceDetails({invoiceType:'SPECIAL'},null),/个人/);
 const base={invoiceType:'SPECIAL',buyerType:'BUSINESS'};
 assert.equal(invoiceDetails(base,'123456789012345678').format,'DIGITAL');
 assert.throws(()=>invoiceDetails({...base,invoiceFormat:'TRADITIONAL'},'123456789012345678'),/注册地址/);
 assert.equal(invoiceDetails({...base,invoiceFormat:'TRADITIONAL',address:'地址',phone:'电话',bank:'银行',account:'账号'},'123456789012345678').bank,'银行');
});
test('网盘链接拒绝脚本、明文HTTP及嵌入账号口令',()=>{
 const {validateLink}=require('../src/services/netdisk');
 for(const url of ['javascript:alert(1)','http://example.com/a','https://user:password@example.com/a'])assert.throws(()=>validateLink({url}));
 assert.equal(validateLink({url:'https://pan.example.com/share',password:'a123'}).password,'a123');
});
