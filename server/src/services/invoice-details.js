'use strict';
const {v}=require('../lib/util');
const {err}=require('../lib/http');
function invoiceDetails(b,taxNumber){
 const type=v.oneOf(b.invoiceType||'NORMAL','发票类型',['NORMAL','SPECIAL']);
 const buyer=v.oneOf(b.buyerType||'PERSONAL','抬头类型',['PERSONAL','BUSINESS']);
 const format=v.oneOf(b.invoiceFormat||'DIGITAL','票据形式',['DIGITAL','TRADITIONAL']);
 if(type==='SPECIAL'&&buyer==='PERSONAL')throw err.bad('个人消费者不能申请增值税专用发票');
 if(buyer==='BUSINESS'&&!/^[A-Za-z0-9]{15,20}$/.test(taxNumber||''))throw err.bad('请填写有效纳税人识别号或统一社会信用代码');
 const result={type,buyer,format};
 for(const [key,label,max] of [['address','注册地址',200],['phone','注册电话',40],['bank','开户银行',120],['account','银行账号',50]]){
  result[key]=v.str(b[key],label,{max,optional:true})||'';
  if(type==='SPECIAL'&&format==='TRADITIONAL'&&!result[key])throw err.bad('传统增值税专用发票请填写'+label);
 }
 return result;
}
module.exports={invoiceDetails};
