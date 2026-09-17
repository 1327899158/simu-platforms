const { request } = require('./request');
async function uploadBase64(endpoint, base64) {
  if (base64.length > 546136) throw Error('图片过大，请裁剪后重试（压缩后400KB以内）');
  const uploadId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  const total = Math.ceil(base64.length / 60000);
  let result;
  for (let index = 0; index < total; index++) {
    const body = { uploadId, index, total, base64: base64.slice(index * 60000, (index + 1) * 60000) };
    try { result = await request('POST', endpoint, body, { silent: true }); }
    catch (e) {
      if (e.statusCode && e.statusCode < 500) throw e;
      result = await request('POST', endpoint, body, { silent: true });
    }
  }
  if (!result || !result.id) throw Error('图片上传未完成，请重试');
  return result;
}
async function preview(endpoint) {
  let stage = '读取材料';
  try {
    wx.showLoading({ title: '读取中…', mask: true });
    const first = await request('GET', endpoint, { chunk: 0 }, { silent: true });
    if (!Number.isInteger(first.total) || first.total < 1 || first.total > 10) throw Error('图片分段信息无效，请更新后端');
    const parts = [first.base64];
    for (let i = 1; i < first.total; i++) {
      const part = await request('GET', endpoint, { chunk: i }, { silent: true });
      if (part.index !== i || part.total !== first.total || part.mime !== first.mime) throw Error('图片分段不一致，请重试');
      parts.push(part.base64);
    }
    stage = '生成本地图片';
    const id = endpoint.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '');
    const path = wx.env.USER_DATA_PATH + '/private-' + id + '.' + (first.mime === 'image/png' ? 'png' : 'jpg');
    await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({ filePath: path, data: parts.join(''), encoding: 'base64', success: resolve, fail: reject }));
    wx.hideLoading(); stage = '预览图片';
    await new Promise((resolve, reject) => wx.previewImage({ current: path, urls: [path], success: resolve, fail: reject }));
  } catch (e) {
    wx.hideLoading();
    wx.showModal({ title: '材料读取失败', content: stage + '：' + (e.message || e.errMsg || '未知错误'), showCancel: false });
  }
}
module.exports = { uploadBase64, preview };
