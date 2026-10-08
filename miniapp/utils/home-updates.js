/** 客户首页提醒：业务进度优先，公告随后。活动与预算保留独立模块。 */
function homeUpdates(notices = [], announcements = []) {
  return [
    ...notices.map(item => ({ key: 'order:' + item.id, kind: 'order', id: item.id, label: '订单', title: item.text, subtitle: item.projectName })),
    ...announcements.map(item => ({ key: 'announcement:' + item.id + ':' + item.revision, kind: 'announcement', id: item.id, revision: item.revision, label: '公告', title: item.title, subtitle: item.content })),
  ];
}
module.exports = { homeUpdates };
