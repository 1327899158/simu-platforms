const LABELS={SUBMITTED:'待审核',APPROVED:'审核通过',PAYING:'模拟打款中',PAID_SIMULATED:'模拟已打款（非真实到账）',FAILED:'打款失败，已解冻',REJECTED:'审核拒绝，已解冻',CANCELLED:'已撤销，已解冻'};
const yuan=n=>(Number(n||0)/100).toFixed(2);
const businessKey=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,14);
function fen(s){if(!/^\d+(\.\d{1,2})?$/.test(String(s)))throw Error('请输入正确金额，最多两位小数');const n=Math.round(Number(s)*100);if(n<100||n>100000000)throw Error('模拟金额须为1至100万元');return n;}
module.exports={LABELS,yuan,businessKey,fen};
