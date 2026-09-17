'use strict';
const {parseDbDate}=require('../lib/util');
const AUTO_COMPLETE_DAYS=14;
function deadline(order){
 if(order.status!=='DELIVERED'||!order.deliveredAt)return null;
 const value=parseDbDate(order.deliveredAt).getTime();
 return Number.isFinite(value)?new Date(value+AUTO_COMPLETE_DAYS*86400000).toISOString():null;
}
module.exports={deadline,AUTO_COMPLETE_DAYS};
