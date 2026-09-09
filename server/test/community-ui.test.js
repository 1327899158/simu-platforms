'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('新增页面已注册、依赖样式存在、所有事件处理器可调用',()=>{
  const app=JSON.parse(read('miniapp/app.json'));
  const pages=[...app.pages,...app.subPackages.flatMap(s=>s.pages.map(p=>s.root+'/'+p))];assert.equal(new Set(pages).size,pages.length);
  for(const page of pages)for(const ext of ['js','json','wxml','wxss'])assert(fs.existsSync(path.join(root,'miniapp',page+'.'+ext)),page+'.'+ext);
  const targets=['favorites','help','support','account-closure','cooperation','incentives'].map(x=>'pages/'+x+'/index').concat(['admin/pages/help/index','admin/pages/support/index']);
  for(const target of targets){assert(pages.includes(target));const base='miniapp/'+target;JSON.parse(read(base+'.json'));const css=read(base+'.wxss');const imported=css.match(/@import "([^"]+)"/)[1];assert(fs.existsSync(path.resolve(root,path.dirname(base),imported)));
    let definition;vm.runInNewContext(read(base+'.js'),{require:()=>({}),Page:x=>definition=x});
    for(const match of read(base+'.wxml').matchAll(/(?:bind|catch)[a-z]+=["']([A-Za-z][A-Za-z0-9_]*)["']/g))assert.equal(typeof definition[match[1]],'function',target+': '+match[1]);
  }
});
test('定向保护覆盖大厅、详情、报价、附件；公开与定向草稿不混用',()=>{
  const market=read('server/src/routes/market.js');assert.match(market,/NOT EXISTS\(SELECT 1 FROM direct_demands/);assert.match(market,/assertScope\(o.id,user.id\)/);
  assert.equal((read('server/src/routes/quotes.js').match(/assertScope\(o.id,user.id\)/g)||[]).length,2);
  assert.match(read('server/src/routes/files.js'),/assertScope\(order.id,user.id\)/);
  const publish=read('miniapp/pages/publish/index.js');assert.match(publish,/_direct_/);assert.match(publish,/directEngineerId: this._directEngineerId/);
});
test('证据前端不再上传公开云文件，管理员与用户预览路径分离',()=>{
  const source=read('miniapp/pages/support/index.js');assert.doesNotMatch(source,/cloud\.uploadFile/);assert.match(source,/\/support\/evidence/);assert.match(read('miniapp/admin/pages/support/index.js'),/previewEvidence\(e.currentTarget.dataset.id,true\)/);
});
test('迁移SQL与启动定义一致，具有领奖唯一约束',()=>{
  const defs=require('../src/services/community-migration').definitions;
  const expected=defs.map(d=>d+' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;').join('\n\n').trim();assert.equal(read('docs/community-features-schema.sql').trim(),expected);
  assert.match(expected,/UNIQUE KEY uq_reward_business\(userId,taskKey,periodKey\)/);
});
