-- 新增案例表；每次只执行下面一条 CREATE TABLE。不会修改订单或已有账号。
CREATE TABLE IF NOT EXISTS engineer_cases (
  id VARCHAR(32) PRIMARY KEY,
  engineerId VARCHAR(32) NOT NULL,
  orderId VARCHAR(32) NOT NULL,
  title VARCHAR(80) NOT NULL,
  summary VARCHAR(1500) NOT NULL,
  imageIds JSON NULL,
  createdAt DATETIME(3) NOT NULL,
  updatedAt DATETIME(3) NOT NULL,
  UNIQUE KEY uq_engineer_case_order(engineerId, orderId),
  INDEX idx_engineer_case_created(engineerId, createdAt),
  FOREIGN KEY(engineerId) REFERENCES users(id),
  FOREIGN KEY(orderId) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
