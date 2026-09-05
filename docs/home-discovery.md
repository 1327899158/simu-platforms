# 首页、工程师等级与活动（本期）

## 部署

需要同时部署 `server` 并重新编译、上传 `miniapp`。后端启动先执行原数据库初始化，再执行 `server/src/services/home-migration.js`；需要当前数据库账号具有 CREATE / ALTER 权限。未访问或改动线上数据库。本期不改订单支付、佣金扣款或钱包余额。

新增 `home_campaigns`，默认三条活动仅首次插入；管理员修改不会被重启覆盖。工程师表新增 levelKey、completedOrderCount、positiveReviewRate、disputeRate、levelUpdatedAt。会话 orderId 改为可空，directKey 唯一约束确保同一客户与工程师复用一条直接咨询会话。上线前按现有流程备份数据库。

## 管理与接口

- 管理员工作台 → 活动管理：新增、修改、排序、上下线，选择发布需求、邀请分享或订单跳转。超级管理员及运营角色有 CAMPAIGN_MANAGE 权限。
- GET /api/home/campaigns：已上线活动；GET/POST /api/admin/campaigns：受权限保护的管理接口。
- GET /api/home/notices：仅当前客户自己的有效订单通知；首页显示时每15秒刷新，离开停止。
- POST /api/home/estimate：type、complexity、urgent；返回 low/high（元）、source、direction。成交不足5笔使用明确标注的参考价，不伪称成交统计。选择预算后跳转发布页；已有草稿保留不覆盖。
- GET /api/home/engineers?direction=&offset=0：仅正常、实名认证通过的真实工程师，20条分页；categories 从实际专业方向生成。
- POST /api/engineers/:id/conversation：客户发起直接咨询；复用会话；消息及附件沿用会话参与者权限。
- GET /api/engineers/level：工程师自身实时统计、当前等级及规则。

## 等级口径

基础资质=实名认证审核通过且存在 SUPPORTING 资质资料。完成数=曾完成交付验收的订单数；好评=现有五维评分综合≥4分，无评价不是100%；纠纷率=发生过纠纷的去重已付款承接订单/全部已付款承接订单（包括撤销的纠纷，不按胜负判定）。

按最低单量、好评率、严格小于的纠纷率门槛选择最高合格等级。高单量未达对应评分标准时回落到较低合格等级。读取等级、推荐和报价列表时重新计算并保存字段。金牌/首席的曝光权重用于推荐及客户可见报价排序；15%/10%/8%仅展示，不应用到支付。

## 奖励扩展边界

GET /api/home/reward-rules 返回 enabled=false 及奖励额度；`reward-policy.planReward` 接受可信服务端事件 REGISTERED、DEMAND_PUBLISHED、ORDER_COMPLETED，返回带确定性幂等键的 DEFERRED 奖励计划。支持新人满1000减50、首次发布30元、邀请注册50币及邀请首单250币，禁止自邀。

本期未连接注册/订单事件，未保存邀请归因，未实际发券、入币、抵扣。后续接入须增加已核实的邀请关系、首单判定、唯一幂等账本、反作弊与事务发放，然后才可启用；不得信任客户端传入 isFirst 或 inviterId。活动详情已明确提示本期未发放。

## 验收

1. 管理员编辑或下线活动，客户首页下拉刷新后同步；三个活动进入各自规则页。
2. 切换仿真类型/规模/加急，标准结构参考为2500–8000，加急为2875–9200；有足够成交时以实际统计为准。
3. 用客户选择专业方向、翻页、发起聊天；工程师可在消息中回复，第三人不可读取消息或附件。
4. 新工程师无资质时不是认证等级；完成资质、订单、评价后查看真实级别；金牌/首席报价排序优先。
5. 订单进入交付、支付、纠纷等状态后首页通知更新，点击对应订单。
6. 支付金额和钱包保持原行为；活动不自动减款。

自动化检查：`node --test server/test/*.test.js`。还需部署测试环境后在微信开发者工具及真机验收页面、云图片及消息推送。
