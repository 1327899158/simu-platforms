'use strict';
const { err } = require('../lib/http');
function validatePromotion(value, directEngineerId) {
  const promotion = value === undefined ? 'NONE' : value;
  if (!['NONE', 'EXPOSURE'].includes(promotion)) throw err.bad('无效的需求展示方式');
  if (directEngineerId && promotion !== 'NONE') throw err.bad('定向需求不支持公开曝光');
  return promotion;
}
function validatePlacement(placement) {
  if (!['hall','home'].includes(placement)) throw err.bad('无效的需求展示位置');
}
function encodeCursor(row, placement) {
  const t = row.createdAt instanceof Date ? row.createdAt.toISOString().slice(0,23).replace('T',' ') : row.createdAt;
  return Buffer.from(JSON.stringify({p:placement,t,id:row.id,r:0})).toString('base64url');
}
function decodeCursor(cursor, placement) {
  try {
    if (cursor.length > 512) throw Error();
    const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(value.p !== placement || value.r !== 0 || typeof value.id !== 'string' || !/^[a-zA-Z0-9]{1,32}$/.test(value.id) ||
       typeof value.t !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,3})?$/.test(value.t)) throw Error();
    return value;
  } catch (_) { throw err.bad('分页位置无效，请刷新需求列表'); }
}
module.exports={validatePromotion,validatePlacement,encodeCursor,decodeCursor};
