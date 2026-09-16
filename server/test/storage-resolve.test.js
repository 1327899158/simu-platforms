'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={exports,loaded:true};};
let file,cleaned=false,signed=0;
mock('../src/config',{config:{cloudbaseEnv:'env'}});
mock('../src/db',{query:async()=>[],queryOne:async sql=>{
 if(sql.includes('FROM uploaded_files'))return file;
 if(sql.includes('file_cleanup_log'))return cleaned?{}:null;
 return null;
}});
mock('../src/tcb',{getStorage:()=>({getTempFileURL:async()=>{signed++;return {fileList:[{tempFileURL:'https://storage.test/signed'}]};}})});
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});
const router=require('../src/lib/http').createRouter();
require('../src/routes/files').register(router);
async function call(user='owner',fileID='cloud://env.bucket/uploads/a'){
 const req=Readable.from([Buffer.from(JSON.stringify({fileID}))]);req.user={id:user,role:'CUSTOMER'};
 const route=router.match('POST','/api/files/resolve-url');let output;
 await route.handler(req,{writeHead(){},end(raw){output=JSON.parse(raw);}});
 return output.data;
}
test('解析云文件先校验业务归属，拒绝任意或已清理文件签名',async()=>{
 file={id:'f',uploaderId:'owner',kind:'MODEL',fileID:'cloud://env.bucket/uploads/a'};
 assert.equal((await call()).url,'https://storage.test/signed');assert.equal(signed,1);
 await assert.rejects(call('stranger'),e=>e.status===403);
 await assert.rejects(call('owner','cloud://other.bucket/a'),e=>e.status===400);
 cleaned=true;await assert.rejects(call(),e=>e.status===404);
 file=null;await assert.rejects(call(),e=>e.status===404);assert.equal(signed,1);
});
