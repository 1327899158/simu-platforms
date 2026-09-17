'use strict';
const { v } = require('../lib/util');
// 保留旧客户端完整响应；新客户端逐段读取，每段仍需经过原接口权限检查。
function imageChunk(image, search) {
  if (!search || search.get('chunk') === null) return image;
  const total = Math.ceil(image.base64.length / 60000);
  const index = v.int(search.get('chunk'), '图片分段', { min: 0, max: total - 1 });
  return { mime: image.mime, total, index, base64: image.base64.slice(index * 60000, (index + 1) * 60000) };
}
module.exports = { imageChunk };
