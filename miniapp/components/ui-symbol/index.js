// UI-only symbol rendering. Never apply to user-authored messages or content.
const ICONS = {"📋":"orders","📄":"orders","📝":"orders","📎":"attachment","📦":"cases","📭":"cases","📚":"cases","🖼":"cases","💬":"support","✉":"support","📨":"support","👤":"user","☺":"user","👨‍💼":"user","🧑‍🔬":"science","🛠":"settings","⚙":"settings","💰":"quote","💳":"quote","🧾":"invoice","⚖":"dispute","⚠":"warning","📉":"chart","📊":"chart","📌":"pin","🎯":"pin","⏳":"clock","⏰":"clock","🕐":"clock","📆":"calendar","📅":"calendar","🔒":"security","🔓":"security","🛡":"security","🔑":"security","✅":"success","❌":"block","🚫":"block","↩":"switch","🔄":"switch","🗑":"trash","✏":"edit","💡":"bulb","⚡":"bolt","🚀":"rocket","✨":"review","⭐":"review","🌟":"review","🏆":"award","🏅":"award","🎖":"award","🥇":"award","🥈":"award","🥉":"award","👑":"award","💎":"award","🆕":"award","📈":"chart","🤝":"cooperation","🔗":"cooperation","☘":"leaf","☀":"sun","🔥":"flame","🌊":"wave","📡":"signal","🔬":"science","☕":"coffee","🔍":"search","⚑":"flag","♥":"favorite","♡":"favorite","⌂":"home","▤":"orders","📣":"signal","👷":"user","🎁":"award","📂":"cases","🔩":"settings","👨‍🔧":"settings","🧪":"science","📱":"identity","👀":"search","👁":"search","🔐":"security","♧":"support"};
const KEYS = Object.keys(ICONS).sort((a,b)=>b.length-a.length);
function parts(value) {
 const input=String(value == null ? '' : value), result=[];let plain='';
 const flush=()=>{if(plain){result.push({text:plain});plain='';}};
 for(let i=0;i<input.length;){
  const key=KEYS.find(k=>input.startsWith(k,i));
  if(key){flush();result.push({src:'/assets/icons-contrast/'+ICONS[key]+'.svg'});i+=key.length;if(input[i]==='\uFE0F')i++;}
  else {plain+=input[i++];}
 }
 flush();return result;
}
Component({
 options:{virtualHost:true},
 properties:{value:{type:String,value:'',observer(value){this.setData({parts:parts(value)});}}},
 data:{parts:[]}
});
