'use strict';
const {requireUser}=require('../lib/auth-mw'),{ok,readJson}=require('../lib/http'),svc=require('../services/invitation-svc');
function register(router){
 router.get('/api/invitations',async(req,res)=>ok(res,await svc.summary(await requireUser(req))));
 router.post('/api/invitations/accept',async(req,res)=>{const u=await requireUser(req),b=await readJson(req);ok(res,await svc.accept(u,b.code));});
 router.get('/api/invitations/qr',async(req,res)=>ok(res,await svc.qr(await requireUser(req))));
 router.post('/api/invitations/link',async(req,res)=>ok(res,await svc.link(await requireUser(req))));
}
module.exports={register};
