'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {resolveMedia}=require('../../miniapp/utils/private-media');
test('私有媒体只转换显示字段、去重请求并保留头像原始ID',async()=>{
 const data={avatarUrl:'cloud://env/a',rows:[{avatarUrl:'cloud://env/a',imgUrl:'cloud://env/b',fileID:'cloud://env/c'}]};
 const called=[];
 await resolveMedia(data,async id=>{called.push(id);return 'https://signed/'+id.slice(-1);});
 assert.deepEqual(called.sort(),['cloud://env/a','cloud://env/b']);
 assert.equal(data.avatarFileID,'cloud://env/a');assert.equal(data.avatarUrl,'https://signed/a');
 assert.equal(data.rows[0].fileID,'cloud://env/c');
});
test('拒绝的媒体不回退绕过鉴权，单图失败不阻断业务响应',async()=>{
 const data={imgUrl:'cloud://env/secret',avatarUrl:'https://existing/avatar',content:'cloud://env/text'};
 await resolveMedia(data,async()=>{throw Error('403');});
 assert.equal(data.imgUrl,'');assert.equal(data.content,'cloud://env/text');assert.equal(data.avatarUrl,'https://existing/avatar');
});
test('创建者规则不使用路径正则，隔离不同微信身份和服务端归档',()=>{
 const rules=require('../../docs/cloud-storage.owner-only.rules.json');
 for(const rule of Object.values(rules)){
  const check=Function('auth','resource','return '+rule);
  assert.equal(check(null,{openid:'a'}),false);
  assert.equal(check({openid:'a'},{openid:'a'}),true);
  assert.equal(check({openid:'b'},{openid:'a'}),false);
  assert.equal(check({openid:'a'},{openid:undefined}),false);
 }
});
