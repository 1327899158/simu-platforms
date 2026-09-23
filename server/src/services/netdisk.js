'use strict';
const {v}=require('../lib/util');const {err}=require('../lib/http');
function validateLink(b){
 const url=v.str(b.url,'网盘链接',{min:10,max:1500});
 let parsed;try{parsed=new URL(url);}catch{throw err.bad('请输入完整的https网盘链接');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||!parsed.hostname.includes('.'))throw err.bad('请使用不含登录信息的https网盘分享链接');
 return {url:parsed.href,password:v.str(b.password,'提取码',{max:100,optional:true})||''};
}
function linkView(file){return {fileID:file.fileID,name:file.name,mime:file.mime,sizeBytes:0,netdiskUrl:file.netdiskUrl,netdiskPassword:file.netdiskPassword||''};}
module.exports={validateLink,linkView};
