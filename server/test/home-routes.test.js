'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const mock = (path, exports) => { require.cache[require.resolve(path)] = { exports, loaded: true }; };
let sample=[];
mock('../src/db',{query:async()=>sample});
mock('../src/lib/auth-mw',{requireUser:async()=>({id:'u'})});
mock('../src/lib/admin-mw',{});
const {createRouter}=require('../src/lib/http');
const router=createRouter();
require('../src/routes/home').register(router);
async function estimate(body) {
  let output;
  const req=Readable.from([Buffer.from(JSON.stringify(body))]);
  await router.match('POST','/api/home/estimate').handler(req,{writeHead(){},end(raw){output=JSON.parse(raw).data;}});
  return output;
}
test('预估参考价、加急系数与真实成交标注',async()=>{
  const input={type:'结构强度',complexity:'标准'};
  let r=await estimate(input);
  assert.equal(r.low,2500); assert.equal(r.high,8000); assert.match(r.source,/参考价/);
  r=await estimate({...input,urgent:true});
  assert.equal(r.low,2875); assert.equal(r.high,9200);
  sample=[100000,200000,300000,400000,1000000].map(finalAmountFen=>({finalAmountFen}));
  r=await estimate(input);
  assert.equal(r.low,3000); assert.equal(r.high,4000); assert.match(r.source,/5笔成交/);
  await assert.rejects(estimate({...input,type:'伪造类型'}),e=>e.status===400);
});
