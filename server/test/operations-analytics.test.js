const test=require('node:test'),assert=require('node:assert/strict');
const calls=[];
require.cache[require.resolve('../src/db')]={loaded:true,exports:{
 parseJson:(x,d)=>{if(x==null)return d;if(typeof x!=='string')return x;try{return JSON.parse(x);}catch{return d;}},
 query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('LIMIT 51'))return Array.from({length:51},(_,i)=>({id:String(i)}));return [];},
 queryOne:async(sql,args)=>{calls.push({sql,args});return {total:0};}
}};
const {windowFor,funnel,supply,overview,rate}=require('../src/services/operations-analytics');
test('滚动窗口不重叠，拒绝非法天数，空分母不伪造零转化',()=>{
 const d=windowFor(7,new Date('2026-09-24T00:00:00Z'));
 assert.equal(d.from,'2026-09-17 00:00:00.000');assert.equal(d.previous,'2026-09-10 00:00:00.000');
 for(const x of [0,-1,91,1.5,NaN])assert.throws(()=>windowFor(x));assert.equal(rate(0,0),null);
 const f=funnel({total:10,quoted:5,selected:2,paid:1,delivered:0,completed:0});assert.equal(f[2].conversion,40);assert.equal(f[3].share,10);assert.equal(f[5].conversion,null);
});
test('供需去重标签，保留无方向与仅有供给的领域',()=>{
 const rows=supply([{directionTags:['热分析','热分析'],demand:4,quoted:1,completed:1,refunds:2,disputes:1},{directionTags:[],demand:1}], [{specialties:['结构'],count:2}]);
 assert.equal(rows[0].demand,4);assert.equal(rows[0].noQuoteRate,75);assert.equal(rows.find(x=>x.name==='结构').noQuoteRate,null);assert.equal(rows.find(x=>x.name==='未填写方向').demand,1);
});
test('无订单权限不查询明细；公开需求、成熟复购、当前延期口径及有界明细',async()=>{
 calls.length=0;const restricted=await overview(7,{orders:false});assert.deepEqual(restricted.exceptions,[]);assert.ok(!calls.some(x=>x.sql.includes('LIMIT 51')));
 assert.ok(calls.some(x=>x.sql.includes('horizons.days DAY')&&x.sql.includes('firsts.firstPaid<=DATE_SUB')));
 assert.ok(calls.some(x=>x.sql.includes('NOT EXISTS(SELECT 1 FROM direct_demands')));
 assert.ok(calls.some(x=>x.sql.includes("senderKind='STAFF'")));
 const result=await overview(30,{orders:true});assert.equal(result.exceptions.length,50);assert.equal(result.exceptionsMore,true);assert.equal(result.overdue.length,50);
 assert.ok(calls.some(x=>x.sql.includes('COALESCE(t.deadline,DATE_ADD(o.paidAt,INTERVAL q.days DAY))')));
 assert.ok(calls.some(x=>x.sql.includes("o.status='AWAITING_PAYMENT'")));
});
