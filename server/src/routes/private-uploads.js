'use strict';
const {requireUser,getOpenid}=require('../lib/auth-mw');
const {readJson,ok,err}=require('../lib/http');
const {v}=require('../lib/util');
const storage=require('../services/private-storage');
function register(router){router.post('/api/private-uploads',async(req,res)=>{
 const u=await requireUser(req);if(!['CUSTOMER','ENGINEER'].includes(u.role))throw err.forbidden();
 const b=await readJson(req,4096),purpose=v.oneOf(b.purpose,'上传用途',['SUPPORT','ENTERPRISE']);
 ok(res,await storage.begin(u,purpose,getOpenid(req)));
});}
module.exports={register};
