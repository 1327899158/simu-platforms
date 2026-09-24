const base = '/admin/pages/';
const consolePath = kind => base + 'console/index?kind=' + kind;
const groups = [
  { key: 'review', title: '审核与仲裁', description: '认证、投诉与履约争议', items: [
    ['engineers', '身份认证审核', '身份及补充资质材料', 'ENGINEER_READ', '🪪'],
    ['enterprise', '企业 / 机构认证', '企业、机构、院校及展示标签', 'IDENTITY_APPROVE', '🏢'],
    ['disputes', '纠纷仲裁', '双方举证、裁决与退款记录', 'DISPUTE_READ', '⚖️'],
    ['support', '举报与反馈', '调查处理并反馈结果', 'SUPPORT_MANAGE', '🚫'],
    ['appeals', '退款申诉', '已转客服介入的退款申请', 'DISPUTE_READ', '📮', consolePath('appeals')],
  ] },
  { key: 'business', title: '业务管理', description: '用户、订单与客服服务', items: [
    ['users', '用户管理', '用户资料、认证及账号状态', 'USER_READ', '👥'],
    ['orders', '订单管理', '订单进度与履约明细', 'ORDER_READ', '📦'],
    ['customer-service', '客服与工单', '在线聊天与工单分别处理', 'CUSTOMER_SERVICE', '🎧'],
  ] },
  { key: 'finance', title: '财务中心', description: '支付记录、发票及模拟提现', items: [
    ['finance', '财务总览', '支付趋势与退款记录汇总', 'FINANCE_READ', '💰', base + 'finance/index'],
    ['wallet', '模拟钱包与提现', '模拟入账、冻结与提现审核', 'WALLET_MANAGE', '💳'],
    ['invoices', '发票管理', '申请审核与电子发票交付', 'INVOICE_READ', '🧾'],
  ] },
  { key: 'operations', title: '运营与配置', description: '数据、内容、权限和平台规则', items: [
    ['preview', '数据看板', '近七日趋势与业务分布', 'DASHBOARD_READ', '📊', base + 'data-preview/index'],
    ['operations', '运营分析', '转化、供需、留存与异常订单', 'DASHBOARD_READ', '📊', consolePath('operations')],
    ['hall', '大厅统计', '供需概览与热门需求', 'DASHBOARD_READ', '📈', consolePath('hall')],
    ['marketing', '营销活动', '活动内容与优惠权益统计', 'CAMPAIGN_MANAGE', '🎟️', consolePath('marketing')],
    ['campaigns', '首页活动管理', '轮播与活动规则', 'CAMPAIGN_MANAGE', '🖼️'],
    ['announcements', '公告管理', '公告内容、时间与接收角色', 'ANNOUNCEMENT_MANAGE', '📢'],
    ['help', '帮助内容', 'FAQ 与平台介绍', 'HELP_MANAGE', '📖'],
    ['storage', '存储管理', '文件登记用量与分类清单', 'STORAGE_READ', '🗄️', consolePath('storage')],
    ['accounts', '账号与权限', '管理员分工及停用管理', 'ADMIN_MANAGE', '🔐', consolePath('accounts')],
    ['config', '平台配置', '大厅排序与运行规则', 'CONFIG_MANAGE', '⚙️', consolePath('config')],
    ['audit', '操作日志', '敏感操作的审计记录', 'AUDIT_READ', '📜', base + 'audit-logs/index'],
  ] },
];
function navigation(admin, stats, hasPermission) {
  return groups.map(group => ({ ...group, items: group.items.map(([key,title,desc,permission,icon,path]) => ({key,title,desc,permission,icon,path:path || base+key+'/index',count: key === 'engineers' ? Number(stats?.engineerReviews?.pending || 0) : Number(stats?.pendingTasks?.[key] || 0)})).filter(item => hasPermission(admin,item.permission)) })).filter(group => group.items.length);
}
module.exports = { navigation };
