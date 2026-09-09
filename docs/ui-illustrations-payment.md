# 背景插画与模拟支付页

## 范围

- 客户首页插画放大，工程师首页使用新生成的安全帽扳手插画，搜索框在前景覆盖底座。
- 接单大厅今日新增区域、订单/报价、身份认证、纠纷/举报及相关管理页面接入装饰图。
- 装饰图片绝对定位并设置 pointer-events:none，不改变表单尺寸或按钮事件。
- 新支付页仅承接原订单详情的 mock 分支；原微信支付分支保留。
- 金额读取服务端，提交时重新校验模式与金额；确认后才调用 mock-confirm，成功状态以查询结果为准。
- 不新增服务费、优惠抵扣或赔付规则，不调用真实支付。

## 资源与生成

使用 imagegen 技能的内置生成工具。原始生成图：icon/engineer_home-generated.png。
小程序引用：miniapp/assets/engineer_home-generated.png。
其余用户原图保存在 icon/；压缩副本保存在 miniapp/assets/。
按用户授权使用 scripts/prepare-ui-illustrations.ps1 等比例缩小到最长边360像素并保留透明通道。
原有电脑及扳手图的未压缩备份为 icon/hero-laptop-original.png、icon/hero-wrench-original.png。

最终生成提示词：

```
Use case: stylized-concept. Generate a single transparent-background PNG mascot asset for the upper-right header of an engineering simulation mini-program. A friendly anthropomorphic light-silver adjustable wrench wearing a small pastel blue safety helmet, large glossy googly eyes, soft pink cheeks and a subtle smile, with a small yellow gear beside its base. Premium soft 3D clay/toy rendering matching the user's blue computer and yellow star illustrations. Soft studio lighting, rounded shapes, blue, warm ivory and butter-yellow palette. Compact centered complete silhouette, near-square composition, minimal empty margins, base may be covered by a foreground search bar. Genuinely transparent alpha background, no opaque backdrop, no text, no letters, no watermark, no UI. Professional approachable restrained styling.
```

## 验收

1. 客户首页、工程师首页长昵称情况下，插画不挡文字，搜索入口可点击。
2. 接单大厅分类、排序、报价仍可用；今日新增数字清晰。
3. 在小屏设备打开报价、认证、举报和纠纷页，输入、上传和弹窗不被插画拦截。
4. 客户选择报价后从订单详情发起模拟支付，核对工程师、订单名称和金额。
5. 取消确认不支付；确认后订单进入执行中，返回详情显示最新状态。
6. 模拟支付失败可刷新重试，金额变化需重新确认，非mock环境不能调用模拟确认。
7. 微信开发者工具上传前检查代码包体积；本地文件求和仅为估算，不替代实际编译包体积。
