import fs from 'node:fs/promises';
import {Workbook,SpreadsheetFile} from '@oai/artifact-tool';
const out='F:/simu-platforms/simu-platforms/outputs/feature-register-20260910';
const rows=[
['账号与资料','注册登录','支持微信、手机号、账号密码登录及协议确认。','已实现'],
['账号与资料','个人资料与身份认证','资料维护、身份认证申请及管理员审核。','已实现'],
['账号与资料','账号注销','支持注销申请、撤销及业务事项检查。','已实现'],
['首页与发现','首页服务入口','活动轮播、进度提醒、费用预估及专业分类。','已实现'],
['首页与发现','推荐工程师','展示工程师资料，支持查看主页和发起沟通。','已实现'],
['首页与发现','需求搜索与接单大厅','按标题、内容、专业方向搜索，支持筛选及热门排序。','已实现'],
['首页与发现','需求浏览量','展示浏览人数，同一账号重复浏览不重复计数。','已实现'],
['订单与交付','发布需求与报价','分步发布需求，工程师报价、修改或撤回报价。','已实现'],
['订单与交付','订单管理','查看订单进度、选择工程师、交付成果及确认验收。','已实现'],
['订单与交付','支付页面','展示订单支付信息并提供模拟支付流程。','模拟功能'],
['订单与交付','退款与纠纷处理','退款申请、协商、举证及管理员处理。','已实现'],
['订单与交付','发票管理','选择订单、批量申请、处理及查看下载发票。','已实现'],
['沟通与评价','在线沟通','双方聊天、文件传输及查看对方资料。','已实现'],
['沟通与评价','双向评价','客户评价工程师，工程师评价客户供平台参考。','已实现'],
['沟通与评价','收藏管理','收藏工程师、案例和需求，支持分类查看与批量移除。','已实现'],
['沟通与评价','黑名单与举报','支持拉黑、解除拉黑及独立举报处理。','已实现'],
['工程师服务','案例展示','已完成订单可设为案例，支持多张图片展示与预览。','已实现'],
['工程师服务','等级与成就展示','展示工程师等级和已获得的成就标签。','已实现'],
['工程师服务','长期合作与定向需求','设置合作条件，双方确认后发起定向需求。','已实现'],
['工程师服务','收益数据','查看订单金额统计、月度趋势及明细。','已实现'],
['工程师服务','钱包与提现','提供余额、冻结、提现申请、审核及模拟打款流程。','模拟功能'],
['工程师服务','银行卡管理','提供测试银行卡信息管理入口。','模拟功能'],
['活动与激励','激励中心','任务、连续挑战、成就及工程师排行榜。','已实现'],
['活动与激励','每日签到','客户与工程师均可签到并获得仿真币。','已实现'],
['活动与激励','卡券与仿真币','支持活动领取、卡券保存及仿真币余额和明细查看。','基础功能已实现'],
['帮助与管理','帮助中心与意见反馈','FAQ、关于我们、反馈提交及后台处理。','已实现'],
['帮助与管理','管理员工作台','用户、认证、订单、发票、内容、举报及操作记录管理。','已实现'],
['界面体验','统一视觉与导航','统一渐变主题、彩色图标、场景插画及首页快捷入口。','已实现'],
['后续扩展','真实资金与开票服务','真实提现、退款对账、自动开票及发送服务。','待接入'],
['后续扩展','营销权益使用','卡券与仿真币抵扣、邀请奖励结算。','待接入'],
['后续扩展','客服与通知','独立客服工单、公告中心及消息偏好设置。','待规划'],
['后续扩展','地址与账号安全','地址管理及完整手机号换绑流程。','待规划'],
['后续扩展','需求与资料增强','多份草稿、需求编辑、案例库及更多搜索筛选条件。','待规划'],
['后续扩展','履约服务增强','延期审批、加急协商、服务约定及分期交易。','待规划'],
['后续扩展','企业与平台运营','企业认证、子账号、信用申诉及更多经营报表。','待规划'],
['后续扩展','文件与运营规则','文件到期提醒、清理及可配置运营规则。','待规划'],
];
const wb=Workbook.create(),s=wb.worksheets.add('项目功能清单');s.showGridLines=false;
const data=rows.map((r,i)=>[i+1,...r]),last=data.length+6;
s.getRange(`A1:E${last}`).format.font={name:'Arial',size:11,color:'#273849'};
[55,130,230,490,150].forEach((w,i)=>s.getRangeByIndexes(0,i,last,1).format.columnWidthPx=w);
s.getRange('A2').values=[['仿真服务平台功能清单']];s.getRange('A2').format.font={size:17,bold:true,color:'#23486B'};s.getRange('A2:E2').format.rowHeight=32;
s.getRange('A3').values=[['更新日期：2026年9月10日。已实现功能以当前版本为准，最终以双方验收结果为准。']];s.getRange('A3:E3').format.rowHeight=24;
s.getRange('A4').values=[['说明：模拟功能不产生真实资金交易；卡券与仿真币暂未启用支付抵扣。']];s.getRange('A4:E4').format.rowHeight=24;
s.getRange(`A6:E${last}`).values=[['序号','功能模块','功能名称','功能说明','当前状态'],...data];
s.tables.add(`A6:E${last}`,true,'ClientFeatures');
s.getRange('A6:E6').format={fill:'#23486B',font:{bold:true,color:'#FFFFFF'},rowHeight:32,horizontalAlignment:'center',verticalAlignment:'center'};
s.getRange(`A7:E${last}`).format.wrapText=true;s.getRange(`A7:E${last}`).format.verticalAlignment='center';s.getRange(`A7:E${last}`).format.rowHeight=43;
data.forEach((r,i)=>s.getRange(`A${i+7}:E${i+7}`).format.fill=i%2?'#F0F4F8':'#FFFFFF');
const status=s.getRange(`E7:E${last}`);status.conditionalFormats.add('containsText',{text:'模拟',format:{fill:'#FFF1CC',font:{color:'#8A5A00'}}});status.conditionalFormats.add('containsText',{text:'待',format:{fill:'#F0F0F0',font:{color:'#666666'}}});
s.freezePanes.freezeRows(6);wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'项目功能清单!A6:E9',tableMaxRows:4,tableMaxCols:5,maxChars:1200})).ndjson);
const preview=await wb.render({sheetName:s.name,range:'A1:E13',scale:1,format:'png'});await fs.writeFile(`${out}/client-preview.png`,new Uint8Array(await preview.arrayBuffer()));
await(await SpreadsheetFile.exportXlsx(wb)).save(`${out}/仿真服务平台功能清单（客户版）.xlsx`);
