const { request } = require('./request');
async function blockUser(id) {
  if (!id) return false;
  const answer = await new Promise(resolve => wx.showModal({
    title: '加入黑名单',
    content: '拉黑后双方不能发起咨询或发送聊天消息。已有订单、交付、售后和平台通知不受影响，历史聊天保留。可在“我的→黑名单”解除。',
    confirmText: '确认拉黑', success: resolve, fail: () => resolve({ confirm:false }),
  }));
  if (!answer.confirm) return false;
  try {
    await request('POST', '/blacklist/' + encodeURIComponent(id), {});
    wx.showToast({ title: '已加入黑名单', icon: 'success' });
    return true;
  } catch (e) { wx.showToast({ title: e.message || '拉黑失败', icon: 'none' }); return false; }
}
module.exports = { blockUser };
