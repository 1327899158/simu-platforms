// Resolve display-only fields; keep file identifiers intact for edits and uploads.
async function resolveMedia(value,resolve){
 const pending=new Map();
 const visit=async item=>{
  if(!item||typeof item!=='object')return;
  await Promise.all(Object.keys(item).map(async key=>{
   const original=item[key];
   if((key==='avatarUrl'||key==='imgUrl')&&typeof original==='string'&&original.startsWith('cloud://')){
    if(!pending.has(original))pending.set(original,resolve(original).catch(()=>''));
    if(key==='avatarUrl')item.avatarFileID=original;
    item[key]=await pending.get(original);
   }else if(typeof original==='object')await visit(original);
  }));
 };
 await visit(value);return value;
}
module.exports={resolveMedia};
