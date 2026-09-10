'use strict';
const {test,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let s,audits=0,queue=Promise.resolve();
const initial=()=>({wallet:{userId:'e',availableFen:0,frozenFen:0},ledger:[],cards:[{id:'card',userId:'e',bankName:'测试银行',lastFour:'0001',status:'ACTIVE'}],withdrawals:[],holds:[],events:[]});
async function execute(sql,a){
 if(sql.startsWith('SELECT id,role,status FROM users'))return [[{id:a[0],role:'ENGINEER',status:'ACTIVE'}]];
 if(sql.includes('FROM account_closures'))return [[]];
 if(sql.startsWith('INSERT IGNORE INTO demo_wallets'))return [{affectedRows:0}];
 if(sql.startsWith('SELECT * FROM demo_wallets'))return [[{...s.wallet}]];
 if(sql.startsWith('UPDATE demo_wallets')){s.wallet.availableFen=a[0];s.wallet.frozenFen=a[1];return [{affectedRows:1}];}
 if(sql.startsWith('SELECT deltaAvailable FROM demo_wallet_ledger'))return [[s.ledger.find(r=>r.businessKey===a[1])].filter(Boolean)];
 if(sql.startsWith('INSERT INTO demo_wallet_ledger')){s.ledger.push({businessKey:a[2],deltaAvailable:a[4],deltaFrozen:a[5]});return [{affectedRows:1}];}
 if(sql.startsWith('SELECT * FROM demo_withdrawals'))return [[s.withdrawals.find(r=>sql.includes('businessKey')?r.businessKey===a[1]:r.id===a[0])].filter(Boolean)];
 if(sql.startsWith('SELECT * FROM demo_bank_cards'))return [[s.cards.find(c=>c.id===a[0]&&c.userId===a[1]&&c.status==='ACTIVE')].filter(Boolean)];
 if(sql.startsWith('INSERT INTO demo_withdrawals')){s.withdrawals.push({id:a[0],userId:a[1],businessKey:a[2],cardId:a[3],amountFen:a[5],status:'SUBMITTED'});return [{affectedRows:1}];}
 if(sql.startsWith('INSERT INTO demo_wallet_holds')){s.holds.push({withdrawalId:a[2],status:'HELD'});return [{affectedRows:1}];}
 if(sql.startsWith('INSERT INTO demo_withdrawal_events')){s.events.push({status:a[2]});return [{affectedRows:1}];}
 if(sql.startsWith('UPDATE demo_wallet_holds')){s.holds.find(r=>r.withdrawalId===a[1]).status=a[0];return [{affectedRows:1}];}
 if(sql.startsWith('UPDATE demo_withdrawals')){s.withdrawals.find(r=>r.id===a[2]).status=a[0];return [{affectedRows:1}];}
 throw Error(sql);
}
mock('../src/db',{query:async()=>[],queryOne:async(sql,a)=>s.withdrawals.find(r=>r.id===a[0])||null,tx(work){
 const run=queue.then(async()=>{const backup=JSON.parse(JSON.stringify(s));try{return await work({execute});}catch(e){s=backup;throw e;}});queue=run.catch(()=>{});return run;
}});
mock('../src/lib/admin-mw',{writeAdminAudit:async()=>{audits++;}});
const wallet=require('../src/services/demo-wallet-svc');
const admin={id:'admin'};
beforeEach(()=>{s=initial();audits=0;queue=Promise.resolve();});
async function credit(){return wallet.credit({},admin,{userId:'e',amountFen:10000,businessKey:'credit-one',note:'测试入账'});}
test('模拟入账唯一业务编号、重复不增发，不能混用金额',async()=>{
 await credit();await credit();assert.equal(s.wallet.availableFen,10000);assert.equal(s.ledger.length,1);
 await assert.rejects(wallet.credit({},admin,{userId:'e',amountFen:20000,businessKey:'credit-one',note:'测试'}),e=>e.status===409);
 assert.equal(audits,1);
});
test('同一提现重试不重复冻结，余额不足回滚，不能越权取消',async()=>{
 await credit();const b={amountFen:7000,cardId:'card',businessKey:'withdraw-one'};
 const [one,two]=await Promise.all([wallet.withdraw('e',b),wallet.withdraw('e',b)]);
 assert.equal(one.id,two.id);assert.equal(s.wallet.availableFen,3000);assert.equal(s.wallet.frozenFen,7000);
 await assert.rejects(wallet.withdraw('e',{...b,businessKey:'withdraw-two'}),e=>e.status===409);
 await assert.rejects(wallet.transition(one.id,'CANCELLED','撤销测试','outsider'),e=>e.status===404);
 await wallet.transition(one.id,'CANCELLED','撤销测试','e');
 await wallet.transition(one.id,'CANCELLED','撤销测试','e');
 assert.equal(s.wallet.availableFen,10000);assert.equal(s.wallet.frozenFen,0);assert.equal(s.holds[0].status,'RELEASED');
});
test('审核、打款状态单向流转，模拟付款与失败解冻保持账本守恒',async()=>{
 await credit();const r=await wallet.withdraw('e',{amountFen:4000,cardId:'card',businessKey:'withdraw-one'});
 await assert.rejects(wallet.transition(r.id,'PAID_SIMULATED','越级处理',null,{},admin),e=>e.status===409);
 for(const status of ['APPROVED','PAYING','PAID_SIMULATED'])await wallet.transition(r.id,status,'测试流程',null,{},admin);
 assert.equal(s.wallet.availableFen,6000);assert.equal(s.wallet.frozenFen,0);
 await assert.rejects(wallet.transition(r.id,'FAILED','迟到失败',null,{},admin),e=>e.status===409);
 const two=await wallet.withdraw('e',{amountFen:3000,cardId:'card',businessKey:'withdraw-two'});
 for(const status of ['APPROVED','PAYING','FAILED'])await wallet.transition(two.id,status,'测试失败',null,{},admin);
 assert.equal(s.wallet.availableFen,6000);assert.equal(s.wallet.frozenFen,0);
 assert.equal(s.ledger.reduce((sum,r)=>sum+r.deltaAvailable,0),s.wallet.availableFen);
 assert.equal(s.ledger.reduce((sum,r)=>sum+r.deltaFrozen,0),s.wallet.frozenFen);
});
test('模拟绑卡拒绝真实敏感字段、全卡号和非法金额',async()=>{
 await assert.rejects(wallet.card('e',{bankName:'银行',lastFour:'0001',cardNumber:'1234567890123456'}),e=>e.status===400);
 await assert.rejects(wallet.card('e',{bankName:'银行',lastFour:'1234567890123456'}),e=>e.status===400);
 for(const n of [-100,0,1.5,100000001])assert.throws(()=>wallet.amount(n));
});

