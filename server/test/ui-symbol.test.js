'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../../miniapp');
const sandbox={Component(){}};
vm.runInNewContext(fs.readFileSync(path.join(root,'components/ui-symbol/index.js'),'utf8')+';this.render=parts;this.icons=ICONS;',sandbox);
test('图标映射资源完整且不依赖系统 emoji 字体',()=>{
 for(const [symbol,name] of Object.entries(sandbox.icons)) {
  assert.ok(fs.existsSync(path.join(root,'assets/icons-contrast',name+'.svg')),name);
  const result=sandbox.render(symbol+'\uFE0F');
  assert.equal(result.length,1,symbol);
  assert.equal(result[0].src,'/assets/icons-contrast/'+name+'.svg');
 }
});
test('动态状态保留文字，评分和勾选语义不变',()=>{
 assert.equal(sandbox.render('处理中…')[0].text,'处理中…');
 assert.equal(sandbox.render('★ 4.9 ✓')[0].text,'★ 4.9 ✓');
 const value=sandbox.render('💳 立即支付');
 assert.equal(value[0].src,'/assets/icons-contrast/quote.svg');
 assert.equal(value[1].text,' 立即支付');
 assert.equal(sandbox.render('👨‍🔧')[0].src,'/assets/icons-contrast/settings.svg');
});
test('图形组件不嵌套在 text 内，也不处理用户消息正文',()=>{
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
 for(const file of walk(root).filter(p=>p.endsWith('.wxml'))){
  const source=fs.readFileSync(file,'utf8').replace(/<wxs\b[\s\S]*?<\/wxs>/g,'');
  let depth=0;
  for(const match of source.matchAll(/<text\b[^>]*>|<\/text>|<ui-symbol\b/g)){
   if(match[0].startsWith('<text'))depth++;
   else if(match[0]==='</text>')depth--;
   else assert.equal(depth,0,file);
  }
 }
 const chat=fs.readFileSync(path.join(root,'pages/chat-room/index.wxml'),'utf8');
 assert.ok(chat.includes('class="message-text">{{item.content}}</view>'));
});
