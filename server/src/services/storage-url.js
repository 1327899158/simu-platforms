'use strict';
const {getStorage}=require('../tcb');
const {err}=require('../lib/http');
// Call only after business authorization. Never expose an arbitrary fileID signing API.
async function storageUrl(fileID){
 const result=await getStorage().getTempFileURL({fileList:[{fileID,maxAge:300}]});
 const item=result.fileList?.[0];
 if(result.code||!item?.tempFileURL||(item.status && item.status!==0))throw err.bad('文件访问地址暂不可用，请稍后重试');
 if(new URL(item.tempFileURL).protocol!=='https:')throw err.bad('文件访问地址不安全');
 return item.tempFileURL;
}
module.exports={storageUrl};
