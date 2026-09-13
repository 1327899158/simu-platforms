const test=require('node:test'),assert=require('node:assert/strict');const http=require('../src/lib/http');let ticket={id:'t',userId:'u',status:'OPEN',evidence:'[]'},audit=0;
function mock(p,exports){require.cache[require.resolve(p)]={exports,loaded:true};}
mock('../src/lib/auth-mw',{requireUser:async req=>req.user});mock('../src/lib/http',{...http,readJson:async req=>req.body});
mock('../src/lib/admin-mw',{requireAdmin:async req=>{if(!req.admin)throw http.err.forbidden();return {admin:{id:'a'},user:req.user};},writeAdminAudit:async()=>audit++});
mock('../src/db',{parseJson:JSON.parse,queryOne:async()=>ticket,query:async(sql,a)=>{if(sql.includes('FROM announcements')){assert.match(sql,/startsAt<=UTC_TIMESTAMP/);assert.match(sql,/endsAt>UTC_TIMESTAMP/);assert.deepEqual(a,['CUSTOMER']);}return [];},tx:fn=>fn({execute:async(sql,a)=>{if(sql.startsWith('SELECT * FROM service_tickets'))return [[ticket]];if(sql.startsWith('UPDATE service_tickets')){ticket.status=a[0];return [{affectedRows:1}];}if(sql.startsWith('INSERT INTO service_ticket_messages'))return [{affectedRows:1}];throw Error(sql);}})});
const {register,validateAnnouncement}=require('../src/routes/customer-service');const router=http.createRouter();register(router);
async function call(method,path,user={id:'u',role:'CUSTOMER'},body={},admin=false){const r=router.match(method,'/api'+path);let data;await r.handler({user,body,admin},{writeHead(){},end(v){data=JSON.parse(v).data;}},r.params,new URLSearchParams());return data;}
test('公告时间、角色校验，用户接口按服务端角色与时间过滤',async()=>{
 const b={title:'公告',content:'内容',targetRole:'CUSTOMER',startsAt:'2026-09-14T09:00:00+08:00',endsAt:'2026-09-14T18:00:00+08:00',enabled:true};assert.equal(validateAnnouncement(b).startsAt.toISOString(),'2026-09-14T01:00:00.000Z');
 assert.throws(()=>validateAnnouncement({...b,endsAt:b.startsAt}));assert.throws(()=>validateAnnouncement({...b,targetRole:'ADMIN'}));
 await call('GET','/announcements');await assert.rejects(call('GET','/admin/announcements'),e=>e.status===403);
});
test('工单隔离，客服回复和关闭/重新打开状态有效',async()=>{
 await assert.rejects(call('GET','/service-tickets/t',{id:'other',role:'ENGINEER'}),e=>e.status===404);
 await assert.rejects(call('POST','/service-tickets/t',{id:'other',role:'ENGINEER'},{action:'REPLY',content:'xx'}),e=>e.status===404);
 await call('POST','/admin/service-tickets/t',{id:'staff'},{action:'ACCEPT'},true);assert.equal(ticket.status,'PROCESSING');assert.equal(audit,1);
 await call('POST','/service-tickets/t',undefined,{action:'CLOSE'});assert.equal(ticket.status,'CLOSED');
 await assert.rejects(call('POST','/service-tickets/t',undefined,{action:'REPLY',content:'xx'}),e=>e.status===409);
 await call('POST','/service-tickets/t',undefined,{action:'REOPEN'});assert.equal(ticket.status,'OPEN');
});
