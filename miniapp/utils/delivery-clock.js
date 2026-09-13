function countdown(deadline,now){const delta=new Date(deadline).getTime()-now;if(!Number.isFinite(delta))return '截止时间待确认';const minutes=Math.ceil(Math.abs(delta)/60000);return (delta<=0?'已逾期 ':'剩余 ')+Math.floor(minutes/1440)+'天 '+Math.floor(minutes%1440/60)+'小时 '+minutes%60+'分钟';}
function display(value){const d=new Date(value);if(!Number.isFinite(d.getTime()))return '';const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;}
module.exports={countdown,display};
