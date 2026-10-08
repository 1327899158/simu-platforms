// 仅在本次运行中保存展示状态：重新登录或重新启动小程序后可再次展示。
let version = 0;
let session = null;

function start(userId) {
  version++;
  session = userId ? { userId, version, shown: false } : null;
}

function pending(userId) {
  if (!userId) return null;
  if (!session || session.userId !== userId) start(userId);
  return session.shown ? null : { userId, version: session.version };
}

function consume(ticket) {
  if (!ticket || !session || session.shown || session.userId !== ticket.userId || session.version !== ticket.version) return false;
  session.shown = true;
  return true;
}

function isCurrent(ticket) {
  return !!(ticket && session && !session.shown && session.userId === ticket.userId && session.version === ticket.version);
}

module.exports = { start, pending, consume, isCurrent };
