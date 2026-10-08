/** 客户首页提醒：业务进度优先，公告与活动随后，保留原入口。 */
function homeUpdates(notices = [], announcements = [], campaigns = []) {
  return [
    ...notices.map(item => ({ key: 'order:' + item.id, kind: 'order', id: item.id, label: '订单', title: item.text, subtitle: item.projectName })),
    ...announcements.map(item => ({ key: 'announcement:' + item.id + ':' + item.revision, kind: 'announcement', id: item.id, revision: item.revision, label: '公告', title: item.title, subtitle: item.content })),
    ...campaigns.map(item => ({ key: 'campaign:' + item.id, kind: 'campaign', id: item.id, label: '活动', title: item.title, subtitle: item.subtitle })),
    { key: 'estimate', kind: 'estimate', label: '预算', title: '不确定预算？先快速预估', subtitle: '10秒了解项目费用，发布需求更精准' },
  ];
}
module.exports = { homeUpdates };
