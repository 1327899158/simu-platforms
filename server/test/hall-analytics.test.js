'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const statements=[];
require.cache[require.resolve('../src/db')]={loaded:true,exports:{
 parseJson:(s,d)=>{if(typeof s!=='string')return s;try{return JSON.parse(s);}catch{return d;}},
 query:async(sql,args)=>{statements.push([sql,args]);if(sql.includes('END category,COUNT'))return [{category:'REFUND_CANCEL',count:'2'}];return [];},
 queryOne:async()=>({total:'10',completed:'3',terminated:'2',disputeOrders:'2',refundOrders:'1'})
}};
const {directions,analytics,tags}=require('../src/services/hall-analytics');
test('多方向订单每方向去重，空方向保留，零样本方向显示，供给不混入需求数',()=>{
 const rows=directions([
  {directionTags:'["结构分析","结构分析","热分析"]',status:'COMPLETED',count:'2'},
  {directionTags:['结构分析'],status:'CLOSED',count:1},
  {directionTags:['热分析'],status:'QUOTING',count:3},
  {directionTags:[],status:'CANCELLED',count:1},
  {directionTags:['热分析'],status:'QUOTING',deleted:1,count:2},
 ],[{specialties:['热分析','热分析'],count:4}]);
 const structure=rows.find(x=>x.name==='结构分析'),heat=rows.find(x=>x.name==='热分析');
 assert.equal(structure.demand,3);assert.equal(structure.completed,2);assert.equal(structure.terminated,1);assert.equal(structure.completionRate,67);
 assert.equal(heat.demand,7);assert.equal(heat.open,3);assert.equal(heat.engineers,4);assert.equal(heat.heat,100);
 assert.equal(rows.find(x=>x.name==='未填写方向').demand,1);
 assert.equal(rows.find(x=>x.name==='流体分析').completionRate,null);
 assert.deepEqual(tags('bad'),[]);assert.deepEqual(tags('[" 热分析 ","热分析"]'),['热分析']);
});
test('异常统计不因多次退款乘增订单数，保留历史关闭订单，不返回退款说明',async()=>{
 const result=await analytics();assert.equal(result.totals.refundOrders,1);assert.equal(result.failures[0].label,'同意退款后取消');
 const orderSql=statements.find(([s])=>s.includes('SELECT o.directionTags'))[0];assert.match(orderSql,/NOT EXISTS/);assert.doesNotMatch(orderSql,/WHERE o.deletedAt IS NULL/);
 const refunds=statements.find(([s])=>s.includes('r.reason LIKE'));
 assert.match(refunds[0],/COUNT\(DISTINCT r.orderId\)/);assert.match(refunds[0],/r.reasonType/);assert.ok(refunds[1].includes('其他：%'));assert.doesNotMatch(refunds[0],/SELECT r\.reason,/);
 const failureSql=statements.find(([s])=>s.includes('END category,COUNT'))[0];assert.match(failureSql,/r.status='AGREED'/);
});
