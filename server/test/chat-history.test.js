'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const mock=(p,exports)=>{require.cache[require.resolve(p)]={loaded:true,exports};};
const messages=Array.from({length:250},(_,i)=>({id:i+1,type:'TEXT',content:String(i+1),senderId:'e'}));
let size=1024*1024+1;
mock('../src/db',{queryOne:async sql=>{
 if(sql.includes('FROM conversations'))return {id:'c',customerId:'u',engineerId:'e',directKey:'u:e'};
 if(sql.includes('COUNT(*)'))return {count:2};
 if(sql.includes('FROM uploaded_files'))return {id:'f',sizeBytes:size,name:'file.zip'};
 return {id:'e',nickname:'peer'};
},query:async(sql,p)=>{
 if(sql.includes('SELECT m.*')){
  let rows=messages.filter(m=>sql.includes('m.id <')?m.id<p[1]:sql.includes('m.id >')?m.id>p[1]:true);
  if(sql.includes('DESC'))rows.reverse();return rows.slice(0,Number(sql.match(/LIMIT (\d+)/)[1]));
 }return [];
}});
mock('../src/lib/auth-mw',{requireUser:async()=>({id:'u'})});mock('../src/services/blacklist-svc',{blocked:async()=>false,assertContact:async()=>{}});
const {createRouter}=require('../src/lib/http');const router=createRouter();require('../src/routes/chat').register(router);
async function history(q){let result;await router.match('GET','/api/conversations/c/messages').handler({}, {writeHead(){},end(s){result=JSON.parse(s).data;}},{id:'c'},new URLSearchParams(q));return result;}
test('首次取最近100条，向上翻页取更早记录，增量保持升序',async()=>{
 const recent=await history({latest:'1',limit:'100'});assert.equal(recent.items[0].id,151);assert.equal(recent.lastId,250);
 const older=await history({before:'151',limit:'100'});assert.equal(older.items[0].id,51);assert.equal(older.items.at(-1).id,150);
 const incremental=await history({after:'248'});assert.deepEqual(incremental.items.map(m=>m.id),[249,250]);
});
test('后端拒绝大于1MB或大小未知的聊天文件',async()=>{
 for(size of [1024*1024+1,0]){
  const req=Readable.from([Buffer.from(JSON.stringify({type:'FILE',fileId:'f'}))]);
  await assert.rejects(router.match('POST','/api/conversations/c/messages').handler(req,{}, {id:'c'}),/1MB/);
 }
});
