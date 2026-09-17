'use strict';
// 自动验收已统一交由云托管 auto-complete-svc 每分钟执行（交付后14天）。
// 保留空操作入口以兼容已有定时触发器，防止旧7天任务提前完成订单。
exports.main = async () => ({ success: true, skipped: 'handled-by-container-14-day-auto-complete' });
