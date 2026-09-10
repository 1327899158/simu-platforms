'use strict';
const {query}=require('../db');
const {requireUser}=require('../lib/auth-mw');
const {requireAdmin}=require('../lib/admin-mw');
const {ok,err,readJson}=require('../lib/http');
const {v}=require('../lib/util');
const wallet=require('../services/demo-wallet-svc'),benefits=require('../services/benefits-svc');
async function member(req){const u=await requireUser(req);if(!['CUSTOMER','ENGINEER'].includes(u.role))throw err.forbidden();return u;}
async function engineer(req){const u=await member(req);if(u.role!=='ENGINEER')throw err.forbidden();return u;}
const offset=q=>v.int(q.get('offset')||0,'offset',{min:0,max:1000000});
function register(router){
 router.get('/api/benefits',async(req,res,p,q)=>ok(res,await benefits.assets((await member(req)).id,offset(q))));
 router.post('/api/benefits/claim',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await benefits.claimOffer(u,b.key));});
 router.post('/api/incentives/signin',async(req,res)=>ok(res,await benefits.signin((await member(req)).id)));
 router.post('/api/incentives/showcase',async(req,res)=>{const u=await member(req),b=await readJson(req);ok(res,await benefits.showcase(u.id,b.key,b.enabled));});
 router.get('/api/wallet',async(req,res,p,q)=>ok(res,await wallet.snapshot((await engineer(req)).id,offset(q))));
 router.post('/api/wallet/card',async(req,res)=>ok(res,await wallet.card((await engineer(req)).id,await readJson(req))));
 router.del('/api/wallet/card',async(req,res)=>ok(res,await wallet.unbind((await engineer(req)).id)));
 router.post('/api/wallet/withdraw',async(req,res)=>ok(res,await wallet.withdraw((await engineer(req)).id,await readJson(req))));
 router.post('/api/wallet/withdrawals/:id/cancel',async(req,res,p)=>ok(res,await wallet.transition(p.id,'CANCELLED','用户撤销模拟提现',(await engineer(req)).id)));
 router.get('/api/admin/wallet',async(req,res,p,q)=>{
  await requireAdmin(req,'WALLET_MANAGE');const rows=await query(`SELECT w.*,u.nickname FROM demo_withdrawals w JOIN users u ON u.id=w.userId ORDER BY w.createdAt DESC,w.id DESC LIMIT 21 OFFSET ${offset(q)}`);
  ok(res,{items:rows.slice(0,20),nextOffset:rows.length>20?offset(q)+20:null});
 });
 router.get('/api/admin/wallet/:id/events',async(req,res,p)=>{await requireAdmin(req,'WALLET_MANAGE');ok(res,await query('SELECT status,note,createdAt FROM demo_withdrawal_events WHERE withdrawalId=? ORDER BY createdAt,id',[p.id]));});
 router.post('/api/admin/wallet/credit',async(req,res)=>{const {admin}=await requireAdmin(req,'WALLET_MANAGE');ok(res,await wallet.credit(req,admin,await readJson(req)));});
 router.post('/api/admin/wallet/:id',async(req,res,p)=>{const {admin}=await requireAdmin(req,'WALLET_MANAGE'),b=await readJson(req);ok(res,await wallet.transition(p.id,b.status,b.note,null,req,admin));});
}
module.exports={register};

