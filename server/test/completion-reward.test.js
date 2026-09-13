const test=require('node:test'),assert=require('node:assert/strict');let order,rows,paid,activation;
require.cache[require.resolve('../src/db')]={exports:{query:async()=>[],tx:fn=>fn({execute:async(sql,a)=>{
 if(sql.startsWith('SELECT o.*'))return [[order]];
 if(sql.startsWith('SELECT activatedAt'))return [[{activatedAt:activation}]];
 if(sql.startsWith('SELECT id FROM payments'))return [[paid?{id:'p'}:null].filter(Boolean)];
 if(sql.startsWith('SELECT id FROM users'))return [[{id:a[0]}]];
 if(sql.startsWith('INSERT IGNORE')){const key=a[1]+':'+a[2];if(!rows.has(key))rows.set(key,500);return [{affectedRows:1}];}
 throw Error(sql);
}})}};
const {grant}=require('../src/services/completion-reward-svc');
test('完单双方各500，同订单重复执行或再次完成不重复发放',async()=>{
 rows=new Map();paid=true;activation=new Date(Date.now()-10000);order={id:'o',status:'COMPLETED',completedAt:new Date(Date.now()-1000),customerId:'c',engineerId:'e',finalAmountFen:10000};
 await grant('o');await grant('o');assert.equal(rows.size,2);assert.equal(rows.get('c:o'),500);assert.equal(rows.get('e:o'),500);
 order.status='IN_PROGRESS';await grant('o');order.status='COMPLETED';await grant('o');assert.equal(rows.size,2);
});
test('不补发历史订单，不奖励未完成、未支付或未来完成时间',async()=>{
 for(const kind of ['old','unpaid','open','future']){rows=new Map();paid=kind!=='unpaid';activation=new Date(Date.now()-10000);order={id:'o',status:kind==='open'?'IN_PROGRESS':'COMPLETED',completedAt:new Date(Date.now()+(kind==='old'?-20000:kind==='future'?10000:-1000)),customerId:'c',engineerId:'e'};await grant('o');assert.equal(rows.size,0,kind);}
});
