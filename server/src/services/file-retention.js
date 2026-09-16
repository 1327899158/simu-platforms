'use strict';
const {query,tx}=require('../db');
const {config}=require('../config');
const chat=require('./chat-svc');
const DAY=86400000;
async function migrate(q){
 await q(`CREATE TABLE IF NOT EXISTS order_file_retention(orderId VARCHAR(32) PRIMARY KEY, completedAt DATETIME(3) NOT NULL, deleteAfter DATETIME(3) NOT NULL, notified7At DATETIME(3) NULL, notified1At DATETIME(3) NULL)`);
 await q(`CREATE TABLE IF NOT EXISTS file_cleanup_log(fileId VARCHAR(32) PRIMARY KEY, orderId VARCHAR(32) NOT NULL, cleanedAt DATETIME(3) NOT NULL, fileID VARCHAR(512) NOT NULL, name VARCHAR(255) NOT NULL)`);
}
function plan(completedAt,now=Date.now()){return new Date(Math.max(new Date(completedAt).getTime()+90*DAY,now+7*DAY));}
function action(row,now=Date.now()){
 if(!row.notified7At)return 'NOTICE7';
 if(now>=new Date(row.deleteAfter).getTime()-DAY&&!row.notified1At)return 'NOTICE1';
 if(row.notified1At&&now>=Math.max(new Date(row.deleteAfter).getTime(),new Date(row.notified1At).getTime()+DAY))return 'DELETE';
 return 'WAIT';
}
async function processOrder(id){
 const notices=[];
 await tx(async c=>{
  const exec=async(sql,args=[])=>{const [r]=await c.execute(sql,args);return r;};
  const [o]=await exec('SELECT o.*,q.engineerId FROM orders o LEFT JOIN quotes q ON q.id=o.selectedQuoteId WHERE o.id=? FOR UPDATE',[id]);
  if(!o)return;
  const blocked=await exec(`SELECT id FROM disputes WHERE orderId=? AND (status<>'RESOLVED' OR refundStatus IN ('PENDING','PROCESSED','FAILED')) UNION SELECT id FROM refund_requests WHERE orderId=? AND status IN ('PENDING','AGREED')`,[id,id]);
  // 客服工单暂未绑定订单，保守地暂停双方所有订单的清理。
  const tickets=await exec("SELECT id FROM service_tickets WHERE userId IN (?,?) AND status IN ('OPEN','PROCESSING') LIMIT 1",[o.customerId,o.engineerId||o.customerId]);
  if(o.status!=='COMPLETED'||o.deletedAt||!o.completedAt||blocked.length||tickets.length){await exec('DELETE FROM order_file_retention WHERE orderId=?',[id]);return;}
  const files=await exec(`SELECT f.* FROM order_attachments a JOIN uploaded_files f ON f.id=a.fileId LEFT JOIN file_cleanup_log l ON l.fileId=f.id WHERE a.orderId=? AND a.purpose IN ('REQUIREMENT','RESULT') AND l.fileId IS NULL FOR UPDATE`,[id]);
  if(!files.length)return;
  let [r]=await exec('SELECT * FROM order_file_retention WHERE orderId=? FOR UPDATE',[id]);
  if(r&&+new Date(r.completedAt)!==+new Date(o.completedAt)){await exec('DELETE FROM order_file_retention WHERE orderId=?',[id]);r=null;}
  if(!r){r={orderId:id,completedAt:o.completedAt,deleteAfter:plan(o.completedAt)};await exec('INSERT INTO order_file_retention(orderId,completedAt,deleteAfter) VALUES(?,?,?)',[id,r.completedAt,r.deleteAfter]);}
  // 首次只在进入最后7天时通知；历史订单从首次扫描起至少保留7天。
  if(Date.now()<+new Date(r.deleteAfter)-7*DAY)return;
  const step=action(r);
  if(step==='NOTICE7'||step==='NOTICE1'){
   const now=new Date();const deadline=new Date(Math.max(+new Date(r.deleteAfter),+now+(step==='NOTICE7'?7:1)*DAY));
   const date=new Date(+deadline+8*3600000).toISOString().slice(0,16).replace('T',' ');
   const content=`订单「${o.title||id}」的模型、附件和交付成果将在北京时间 ${date} 后自动清理（${step==='NOTICE7'?'提前7天':'提前1天'}提醒）。请客户和工程师及时下载备份；订单记录保留。售后处理中暂停清理，被其他业务引用的文件暂不清理。`;
   const conv=await chat.ensureConversation(id,c);const {msgId}=await chat.systemMessage(conv.id,content,c,{actionOrderId:id});
   await exec(`UPDATE order_file_retention SET ${step==='NOTICE7'?'notified7At':'notified1At'}=?,deleteAfter=? WHERE orderId=?`,[now,deadline,id]);
   notices.push({conv,content,msgId});return;
  }
  if(step!=='DELETE')return;
  for(const f of files){
   // 任何其他业务引用均保留，包括聊天、认证、案例、退款和纠纷证据。
   const refs=await exec(`SELECT fileId FROM order_attachments WHERE fileId=? AND orderId<>?
    UNION SELECT fileId FROM messages WHERE fileId=?
    UNION SELECT fileId FROM identity_verification_files WHERE fileId=?
    UNION SELECT fileId FROM engineer_verification_files WHERE fileId=?
    UNION SELECT fileId FROM invoice_request_files WHERE fileId=?
    UNION SELECT fileId FROM dispute_evidence WHERE fileId=?
    UNION SELECT fileId FROM refund_request_files WHERE fileId=?
    UNION SELECT id FROM engineer_cases WHERE JSON_CONTAINS(imageIds,JSON_QUOTE(?))
    UNION SELECT id FROM users WHERE avatarUrl=?
    UNION SELECT id FROM uploaded_files WHERE fileID=? AND id<>?`,[f.id,id,f.id,f.id,f.id,f.id,f.id,f.id,f.id,f.fileID,f.fileID,f.id]);
   if(refs.length)continue;
   const authority=String(f.fileID||'').slice(8).split('/')[0];
   if(!String(f.fileID).startsWith('cloud://')||!config.cloudbaseEnv||!(authority===config.cloudbaseEnv||authority.startsWith(config.cloudbaseEnv+'.'))||!String(f.fileID).includes('/uploads/'))continue;
   const result=await require('../tcb').getStorage().deleteFile({fileList:[f.fileID]});
   const item=result.fileList?.find(x=>(x.fileID||x.fileid)===f.fileID);
   const code=item?.code??item?.status;
   if(result.code||!item||!['0','SUCCESS'].includes(String(code)))throw Error('云存储未确认删除成功');
   await exec('INSERT INTO file_cleanup_log(fileId,orderId,cleanedAt,fileID,name) VALUES(?,?,UTC_TIMESTAMP(3),?,?)',[f.id,id,f.fileID,f.name]);
   // 每个事务只删除一个对象，避免后续对象失败导致此前清理记录回滚。
   break;
  }
 });
 for(const n of notices)chat.publishSystemMessage(n.conv.id,n.content,n.msgId,{actionOrderId:id});
}
let busy=false,timer;
async function sweep(){if(busy)return;busy=true;try{
 const rows=await query("SELECT id FROM orders WHERE status='COMPLETED' AND completedAt<=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 83 DAY) UNION SELECT orderId AS id FROM order_file_retention");
 for(const r of rows)try{await processOrder(r.id);}catch(e){console.error('[file-retention]',r.id,e.message);}
}finally{busy=false;}}
function start(){if(timer)return;const run=()=>sweep().catch(e=>console.error('[file-retention-sweep]',e.message));run();timer=setInterval(run,3600000);timer.unref?.();}
module.exports={migrate,plan,action,processOrder,sweep,start};
