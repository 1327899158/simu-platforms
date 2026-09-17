'use strict';
const { getStorage } = require('../tcb');
// 仅在调用方完成管理权限和文件业务权限校验后使用。
async function adminFileUrl(file) {
  try {
    const result = await getStorage().getTempFileURL({ fileList: [{ fileID: file.fileID, maxAge: 300 }] });
    const url = result.fileList?.[0]?.tempFileURL;
    if (url) return { ...file, url };
  } catch (e) { console.warn('[admin-file-url]', e.code || e.message); }
  return file; // 云存储公开读模式仍可通过 fileID 访问。
}
module.exports = { adminFileUrl };
