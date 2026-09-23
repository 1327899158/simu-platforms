'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
function load(relative, deps, wx = {}, extra = {}) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../miniapp', relative), 'utf8'), {
    Page: d => { definition = d; }, Component: d => { definition = d; },
    require: p => deps(p), wx, console, setTimeout, clearTimeout, setInterval, clearInterval, ...extra,
  });
  return { ...definition, ...definition.methods, data: { ...definition.data }, setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); } };
}
test('聊天初始展示最新页，历史翻页保留新消息；超限文件不会上传', async () => {
  let uploads = 0, fileSize = 1024 * 1024 + 1, lastQuery;
  const request = async (method, _url, body) => {
    lastQuery = body;
    if (method === 'POST') return { id: 252, type: 'FILE', senderId: 'me' };
    return { items: body.before ? [{ id: 150, type: 'TEXT' }] : Array.from({ length: 100 }, (_, n) => ({ id: 151 + n, type: 'TEXT' })), lastId: 250 };
  };
  const page = load('pages/chat-room/index.js', p => p.endsWith('/request') ? { request, upload: async () => { uploads++; return { id: 'f' }; } } : { timeShort: () => '' }, {
    chooseMessageFile: o => o.success({ tempFiles: [{ size: fileSize, name: 'f.pdf', path: '/file' }] }), showToast() {},
  });
  page.data.convId = 'c'; page.data.myId = 'me'; page._seenIds = new Set();
  await page.pullHistory(); assert.equal(lastQuery.latest, 1); assert.equal(page.data.scrollAnchor, 'chat-bottom');
  await page.loadOlder(); assert.equal(lastQuery.before, 151); assert.equal(page.data.msgs[0].id, 150); assert.equal(page.data.lastId, 250);
  await page.sendFile(); assert.equal(uploads, 0);
  fileSize = 1024 * 1024; await page.sendFile(); assert.equal(uploads, 1); assert.equal(page.data.msgs.at(-1).id, 252);
  page.keyboardChange({ detail: { height: 280 } }); assert.equal(page.data.keyboardHeight, 280);
});
test('客服双端发送后显示最新回复，同步不会覆盖正在输入的内容，隐藏后停止轮询', async () => {
  for (const admin of [false, true]) {
    const messages = []; let poll, stopped = false, posted;
    const desk = load('components/service-desk/index.js', () => ({ request: async (method, url, body) => {
      if (method === 'POST') { posted = { url, body }; messages.push({ id: 1, content: body.content, senderKind: admin ? 'STAFF' : 'USER' }); return {}; }
      if (url.endsWith('/t')) return { id: 't', status: 'PROCESSING', messages: [...messages] };
      if (url === '/help') return [];
      return { items: [], hasMore: false };
    } }), { showToast() {} }, { setInterval: fn => { poll = fn; return 7; }, clearInterval: () => { stopped = true; } });
    desk.data.admin = admin; desk.start(); await desk.openId('t');
    desk.data.reply = '测试回复'; await desk.sendReply();
    assert.equal(posted.url, (admin ? '/admin' : '') + '/service-tickets/t');
    assert.equal(posted.body.content, '测试回复'); assert.equal(desk.data.detail.messages.length, 1);
    assert.equal(desk.data.chatAnchor, 'service-bottom');
    desk.data.reply = '草稿'; poll(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(desk.data.reply, '草稿'); desk.stop(); assert.ok(stopped);
  }
});
test('查看工程师资料直接跳转到完整资料页', async () => {
  let url;
  const page = load('pages/peer-profile/index.js', () => ({ request: async () => ({ id: 'e', role: 'ENGINEER' }) }), { redirectTo: o => { url = o.url; } });
  page.data.convId = 'c'; await page.load(); assert.equal(url, '/pages/engineer-profile/index?id=e');
});
