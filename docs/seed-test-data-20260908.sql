-- 仿真平台测试数据；依据本地代码表结构编写，未在云端数据库执行。
-- 仅限独立测试库，服务 PAYMENT_MODE=mock；不要导入正式运营库。
-- 先部署当前后端，确认相关建表/迁移已完成，再选中目标测试数据库运行。
-- 一次性脚本：不覆盖既有记录，不使用 INSERT IGNORE/REPLACE，不关闭外键。
-- 如出现重复键/缺表等错误，立即停止并在同一连接执行 ROLLBACK；不要继续 COMMIT。
-- 用支持事务的同一 MySQL 连接执行，客户端必须遇错停止（不要加 --force）。
-- 云控制台若只支持单条执行或不保证同一连接，不要分段执行本文件。
-- 账号密码统一：123456（公开测试口令，禁止生产使用）。
-- 不创建真实手机号、OpenID、身份证号或不存在的云文件。
SELECT DATABASE() AS target_database;
SET @seed_now = UTC_TIMESTAMP(3);
SET @seed_password_hash = '$2b$10$rZmAKgutm2EgbW7HMTbQku8BCUpMi8rzzxi/mWHbBUGD207XAvtC.';
START TRANSACTION;

INSERT INTO users (id, role, username, phone, openid, passwordHash, nickname, status, createdAt, updatedAt) VALUES
  ('seed260908_c1', 'CUSTOMER', '9909080001', NULL, NULL, @seed_password_hash, '测试客户甲', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_c2', 'CUSTOMER', '9909080002', NULL, NULL, @seed_password_hash, '测试客户乙', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_c3', 'CUSTOMER', '9909080003', NULL, NULL, @seed_password_hash, '测试客户待审核', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_e1', 'ENGINEER', '9909081001', NULL, NULL, @seed_password_hash, '测试结构工程师', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_e2', 'ENGINEER', '9909081002', NULL, NULL, @seed_password_hash, '测试流体工程师', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_e3', 'ENGINEER', '9909081003', NULL, NULL, @seed_password_hash, '测试工程师待审核', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now),
  ('seed260908_e4', 'ENGINEER', '9909081004', NULL, NULL, @seed_password_hash, '测试工程师被驳回', 'ACTIVE', DATE_SUB(@seed_now, INTERVAL 15 DAY), @seed_now);

INSERT INTO engineer_profiles (userId, realName, specialties, softwares, intro, verifyStatus) VALUES
  ('seed260908_e1', '测试结构工程师', '["结构分析"]', '["ANSYS全系列"]', '仅用于界面和业务联调的虚构工程师，不是真实资质。', 'APPROVED'),
  ('seed260908_e2', '测试流体工程师', '["流体分析"]', '["OpenFOAM"]', '仅用于界面和业务联调的虚构工程师，不是真实资质。', 'APPROVED'),
  ('seed260908_e3', '测试工程师待审核', '["结构分析"]', '["ANSYS全系列"]', '仅用于界面和业务联调的虚构工程师，不是真实资质。', 'PENDING'),
  ('seed260908_e4', '测试工程师被驳回', '["结构分析"]', '["ANSYS全系列"]', '仅用于界面和业务联调的虚构工程师，不是真实资质。', 'REJECTED');

INSERT INTO identity_verifications (userId, realName, phone, idCardCipher, idCardHash, verifyStatus, reviewReason, submittedAt, reviewedAt, updatedAt) VALUES
  ('seed260908_c1', '测试客户甲', NULL, NULL, NULL, 'APPROVED', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), DATE_SUB(@seed_now, INTERVAL 11 DAY), @seed_now),
  ('seed260908_c2', '测试客户乙', NULL, NULL, NULL, 'APPROVED', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), DATE_SUB(@seed_now, INTERVAL 11 DAY), @seed_now),
  ('seed260908_c3', '测试客户待审核', NULL, NULL, NULL, 'PENDING', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), NULL, @seed_now),
  ('seed260908_e1', '测试结构工程师', NULL, NULL, NULL, 'APPROVED', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), DATE_SUB(@seed_now, INTERVAL 11 DAY), @seed_now),
  ('seed260908_e2', '测试流体工程师', NULL, NULL, NULL, 'APPROVED', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), DATE_SUB(@seed_now, INTERVAL 11 DAY), @seed_now),
  ('seed260908_e3', '测试工程师待审核', NULL, NULL, NULL, 'PENDING', '测试种子状态，不代表真实实名认证。', DATE_SUB(@seed_now, INTERVAL 12 DAY), NULL, @seed_now),
  ('seed260908_e4', '测试工程师被驳回', NULL, NULL, NULL, 'REJECTED', '测试场景：资料不齐，请补充。', DATE_SUB(@seed_now, INTERVAL 12 DAY), DATE_SUB(@seed_now, INTERVAL 11 DAY), @seed_now);

INSERT INTO orders (id, orderNo, customerId, projectName, description, softwareTags, directionTags, budgetFen, budgetFlexible, deliveryDays, specialNote, status, selectedQuoteId, finalAmountFen, selectedAt, paidAt, deliveredAt, completedAt, closedAt, createdAt, updatedAt) VALUES
  ('seed260908_o01', 'TEST260908001', 'seed260908_c1', '[测试] 待工程师报价', '仅供测试：待工程师报价。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 200000, 0, 7, '测试数据，勿用于真实交易。', 'QUOTING', NULL, NULL, NULL, NULL, NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o02', 'TEST260908002', 'seed260908_c1', '[测试] 多工程师报价对比', '仅供测试：多工程师报价对比。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 380000, 1, 7, '测试数据，勿用于真实交易。', 'QUOTING', NULL, NULL, NULL, NULL, NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o03', 'TEST260908003', 'seed260908_c1', '[测试] 已选工程师待支付', '仅供测试：已选工程师待支付。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 380000, 0, 7, '测试数据，勿用于真实交易。', 'AWAITING_PAYMENT', NULL, 380000, @seed_now, NULL, NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o04', 'TEST260908004', 'seed260908_c1', '[测试] 工程师执行中', '仅供测试：工程师执行中。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 560000, 0, 7, '测试数据，勿用于真实交易。', 'IN_PROGRESS', NULL, 560000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o05', 'TEST260908005', 'seed260908_c1', '[测试] 成果已提交待验收', '仅供测试：成果已提交待验收。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 380000, 0, 7, '测试数据，勿用于真实交易。', 'DELIVERED', NULL, 380000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o06', 'TEST260908006', 'seed260908_c1', '[测试] 已完成待评价待开票', '仅供测试：已完成待评价待开票。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 380000, 0, 7, '测试数据，勿用于真实交易。', 'COMPLETED', NULL, 380000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o07', 'TEST260908007', 'seed260908_c2', '[测试] 已完成双方已评价', '仅供测试：已完成双方已评价。由 SQL 创建的状态快照，无真实资金或云文件。', '["OpenFOAM"]', '["流体分析"]', 620000, 0, 7, '测试数据，勿用于真实交易。', 'COMPLETED', NULL, 620000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o08', 'TEST260908008', 'seed260908_c1', '[测试] 退款申请待工程师确认', '仅供测试：退款申请待工程师确认。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 250000, 0, 7, '测试数据，勿用于真实交易。', 'REFUND_PENDING', NULL, 250000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o09', 'TEST260908009', 'seed260908_c2', '[测试] 工程师同意退款订单取消', '仅供测试：工程师同意退款订单取消。由 SQL 创建的状态快照，无真实资金或云文件。', '["OpenFOAM"]', '["流体分析"]', 460000, 0, 7, '测试数据，勿用于真实交易。', 'CANCELLED', NULL, 460000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), NULL, NULL, DATE_SUB(@seed_now, INTERVAL 1 DAY), DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o10', 'TEST260908010', 'seed260908_c2', '[测试] 报价阶段需求已关闭', '仅供测试：报价阶段需求已关闭。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 180000, 0, 7, '测试数据，勿用于真实交易。', 'CLOSED', NULL, NULL, NULL, NULL, NULL, NULL, DATE_SUB(@seed_now, INTERVAL 1 DAY), DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o11', 'TEST260908011', 'seed260908_c1', '[测试] 交付后质量纠纷处理中', '仅供测试：交付后质量纠纷处理中。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 480000, 0, 7, '测试数据，勿用于真实交易。', 'DISPUTING', NULL, 480000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), NULL, NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o12', 'TEST260908012', 'seed260908_c1', '[测试] 已申请发票待工程师处理', '仅供测试：已申请发票待工程师处理。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 383800, 0, 7, '测试数据，勿用于真实交易。', 'COMPLETED', NULL, 383800, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o13', 'TEST260908013', 'seed260908_c2', '[测试] 工程师自行开票中', '仅供测试：工程师自行开票中。由 SQL 创建的状态快照，无真实资金或云文件。', '["OpenFOAM"]', '["流体分析"]', 156000, 0, 7, '测试数据，勿用于真实交易。', 'COMPLETED', NULL, 156000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now),
  ('seed260908_o14', 'TEST260908014', 'seed260908_c1', '[测试] 已转交平台协助开票', '仅供测试：已转交平台协助开票。由 SQL 创建的状态快照，无真实资金或云文件。', '["ANSYS全系列"]', '["结构分析"]', 290000, 0, 7, '测试数据，勿用于真实交易。', 'COMPLETED', NULL, 290000, DATE_SUB(@seed_now, INTERVAL 7 DAY), DATE_SUB(@seed_now, INTERVAL 6 DAY), DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), NULL, DATE_SUB(@seed_now, INTERVAL 10 DAY), @seed_now);

INSERT INTO quotes (id, orderId, engineerId, amountFen, days, solution, status, createdAt, updatedAt) VALUES
  ('seed260908_q03', 'seed260908_o03', 'seed260908_e1', 380000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q04', 'seed260908_o04', 'seed260908_e1', 560000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q05', 'seed260908_o05', 'seed260908_e1', 380000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q06', 'seed260908_o06', 'seed260908_e1', 380000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q07', 'seed260908_o07', 'seed260908_e2', 620000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q08', 'seed260908_o08', 'seed260908_e1', 250000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q09', 'seed260908_o09', 'seed260908_e2', 460000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q11', 'seed260908_o11', 'seed260908_e1', 480000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q12', 'seed260908_o12', 'seed260908_e1', 383800, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q13', 'seed260908_o13', 'seed260908_e2', 156000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q14', 'seed260908_o14', 'seed260908_e1', 290000, 7, '测试技术方案：建立模型、检查网格、执行求解并整理结果报告。', 'SELECTED', DATE_SUB(@seed_now, INTERVAL 8 DAY), @seed_now),
  ('seed260908_q02a', 'seed260908_o02', 'seed260908_e1', 380000, 7, '测试方案甲：结构强度建模及有限元分析，提供完整分析报告。', 'PENDING', DATE_SUB(@seed_now, INTERVAL 2 DAY), @seed_now),
  ('seed260908_q02b', 'seed260908_o02', 'seed260908_e2', 420000, 5, '测试方案乙：多方案对比验证，并整理关键工况数据供验收。', 'PENDING', DATE_SUB(@seed_now, INTERVAL 1 DAY), @seed_now);

UPDATE orders o JOIN quotes qt ON qt.orderId=o.id AND qt.status='SELECTED'
SET o.selectedQuoteId=qt.id
WHERE o.id IN ('seed260908_o03', 'seed260908_o04', 'seed260908_o05', 'seed260908_o06', 'seed260908_o07', 'seed260908_o08', 'seed260908_o09', 'seed260908_o11', 'seed260908_o12', 'seed260908_o13', 'seed260908_o14');

INSERT INTO payments (id, orderId, outTradeNo, transactionId, amountFen, status, paidAt, raw, createdAt) VALUES
  ('seed260908_p3', 'seed260908_o03', 'SEED260908PAY3', NULL, 380000, 'PENDING', NULL, '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', @seed_now),
  ('seed260908_p4', 'seed260908_o04', 'SEED260908PAY4', 'SEED260908TX4', 560000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p5', 'seed260908_o05', 'SEED260908PAY5', 'SEED260908TX5', 380000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p6', 'seed260908_o06', 'SEED260908PAY6', 'SEED260908TX6', 380000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p7', 'seed260908_o07', 'SEED260908PAY7', 'SEED260908TX7', 620000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p8', 'seed260908_o08', 'SEED260908PAY8', 'SEED260908TX8', 250000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p9', 'seed260908_o09', 'SEED260908PAY9', 'SEED260908TX9', 460000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p11', 'seed260908_o11', 'SEED260908PAY11', 'SEED260908TX11', 480000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p12', 'seed260908_o12', 'SEED260908PAY12', 'SEED260908TX12', 383800, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p13', 'seed260908_o13', 'SEED260908PAY13', 'SEED260908TX13', 156000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_p14', 'seed260908_o14', 'SEED260908PAY14', 'SEED260908TX14', 290000, 'SUCCESS', DATE_SUB(@seed_now, INTERVAL 6 DAY), '{"mock":true,"seed":"20260908","notice":"测试占位，无真实扣款或退款"}', DATE_SUB(@seed_now, INTERVAL 6 DAY));

INSERT INTO conversations (id, orderId, customerId, engineerId, lastMsgAt, createdAt) VALUES
  ('seed260908_cv3', 'seed260908_o03', 'seed260908_c1', 'seed260908_e1', @seed_now, @seed_now),
  ('seed260908_cv4', 'seed260908_o04', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv5', 'seed260908_o05', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv6', 'seed260908_o06', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv7', 'seed260908_o07', 'seed260908_c2', 'seed260908_e2', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv8', 'seed260908_o08', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv9', 'seed260908_o09', 'seed260908_c2', 'seed260908_e2', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv11', 'seed260908_o11', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv12', 'seed260908_o12', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv13', 'seed260908_o13', 'seed260908_c2', 'seed260908_e2', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv14', 'seed260908_o14', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 6 DAY)),
  ('seed260908_cv02a', 'seed260908_o02', 'seed260908_c1', 'seed260908_e1', @seed_now, DATE_SUB(@seed_now, INTERVAL 1 DAY)),
  ('seed260908_cv02b', 'seed260908_o02', 'seed260908_c1', 'seed260908_e2', @seed_now, DATE_SUB(@seed_now, INTERVAL 1 DAY));

INSERT INTO messages (convId, senderId, type, content, createdAt) VALUES
  ('seed260908_cv3', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv4', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv5', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv6', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv7', 'seed260908_e2', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv8', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv9', 'seed260908_e2', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv11', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv12', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv13', 'seed260908_e2', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv14', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv02a', 'seed260908_e1', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now),
  ('seed260908_cv02b', 'seed260908_e2', 'TEXT', '[测试消息] 已收到需求，请核对测试订单的当前进度。', @seed_now);

INSERT INTO refund_requests (id, orderId, customerId, engineerId, status, orderStatusAtRequest, reason, createdAt, respondedAt, updatedAt) VALUES
  ('seed260908_rf08', 'seed260908_o08', 'seed260908_c1', 'seed260908_e1', 'PENDING', 'IN_PROGRESS', '[测试] 客户需求发生变化，申请取消合作。', @seed_now, NULL, @seed_now),
  ('seed260908_rf09', 'seed260908_o09', 'seed260908_c2', 'seed260908_e2', 'AGREED', 'IN_PROGRESS', '[测试] 工程师已同意取消；仅状态演示，未发生真实退款。', DATE_SUB(@seed_now, INTERVAL 2 DAY), DATE_SUB(@seed_now, INTERVAL 1 DAY), @seed_now);

INSERT INTO disputes (id, orderId, initiatorId, reasonType, description, status, orderStatusAtOpen, evidenceDeadlineAt, refundStatus, createdAt, updatedAt) VALUES
  ('seed260908_d11', 'seed260908_o11', 'seed260908_c1', 'QUALITY', '[测试] 成果质量存在争议，等待双方补充证据。', 'OPEN', 'DELIVERED', DATE_ADD(@seed_now, INTERVAL 2 DAY), 'NONE', @seed_now, @seed_now);

INSERT INTO engineer_reviews (id, orderId, customerId, engineerId, qualityScore, attitudeScore, speedScore, professionalScore, communicationScore, content, revisionCount, createdAt, updatedAt) VALUES
  ('seed260908_er07', 'seed260908_o07', 'seed260908_c2', 'seed260908_e2', 5, 5, 4, 5, 5, '[测试评价] 沟通及时，报告内容清晰。', 0, DATE_SUB(@seed_now, INTERVAL 1 DAY), @seed_now);

INSERT INTO customer_reviews (id, orderId, customerId, engineerId, score, tags, content, revisionCount, createdAt, updatedAt) VALUES
  ('seed260908_cr07', 'seed260908_o07', 'seed260908_c2', 'seed260908_e2', 5, '["需求描述清晰","回复及时"]', '[测试内部评价] 客户配合验收，沟通顺畅。', 0, DATE_SUB(@seed_now, INTERVAL 1 DAY), @seed_now);

INSERT INTO invoice_requests (id, orderId, customerId, engineerId, invoiceTitle, email, customerNote, status, handlingMode, requestedAt, handledAt, createdAt, updatedAt) VALUES
  ('seed260908_iv12', 'seed260908_o12', 'seed260908_c1', 'seed260908_e1', '测试客户甲', NULL, '[测试] 待处理', 'REQUESTED', NULL, @seed_now, NULL, @seed_now, @seed_now),
  ('seed260908_iv13', 'seed260908_o13', 'seed260908_c2', 'seed260908_e2', '测试客户乙', NULL, '[测试] 请上传自行开具的测试发票文件', 'SELF_ISSUE', 'SELF_ISSUE', @seed_now, @seed_now, @seed_now, @seed_now),
  ('seed260908_iv14', 'seed260908_o14', 'seed260908_c1', 'seed260908_e1', '测试客户甲', NULL, '[测试] 请管理员上传测试发票文件', 'PLATFORM_REQUESTED', 'PLATFORM', @seed_now, @seed_now, @seed_now, @seed_now);

COMMIT;

-- 执行后核对：应为 7 个账号、14 笔订单；无真实扣款。
SELECT username,nickname,role FROM users WHERE id IN ('seed260908_c1', 'seed260908_c2', 'seed260908_c3', 'seed260908_e1', 'seed260908_e2', 'seed260908_e3', 'seed260908_e4') ORDER BY username;
SELECT status,COUNT(*) AS count FROM orders WHERE orderNo LIKE 'TEST260908%' GROUP BY status;
SELECT o.orderNo,o.projectName,o.status,c.username AS customerUsername,e.username AS engineerUsername,o.finalAmountFen/100 AS finalAmountYuan
FROM orders o JOIN users c ON c.id=o.customerId
LEFT JOIN quotes qt ON qt.id=o.selectedQuoteId LEFT JOIN users e ON e.id=qt.engineerId
WHERE o.orderNo LIKE 'TEST260908%' ORDER BY o.orderNo;
