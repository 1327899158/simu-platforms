const {request}=require('./request');
const KEY='pending-invitation';
function capture(options={}){
 const q=options.query||options;let scene='';try{scene=decodeURIComponent(q.scene||'');}catch(_){}
 const code=String(q.invite||(/^invite=([a-f0-9]{16})$/i.exec(scene)||[])[1]||'').toLowerCase();
 if(!/^[a-f0-9]{16}$/.test(code))return;
 const old=wx.getStorageSync(KEY);if(!old||old.expiresAt<Date.now())wx.setStorageSync(KEY,{code,expiresAt:Date.now()+86400000});
}
async function accept(){
 const saved=wx.getStorageSync(KEY);if(!saved)return;
 if(saved.expiresAt<Date.now()){wx.removeStorageSync(KEY);return;}
 try{await request('POST','/invitations/accept',{code:saved.code},{silent:true});wx.removeStorageSync(KEY);}catch(_){}
}
module.exports={capture,accept};
