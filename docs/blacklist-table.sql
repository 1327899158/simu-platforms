CREATE TABLE IF NOT EXISTS user_blocks (
  ownerId VARCHAR(32) NOT NULL,
  blockedUserId VARCHAR(32) NOT NULL,
  createdAt DATETIME(3) NOT NULL,
  PRIMARY KEY(ownerId, blockedUserId),
  INDEX idx_blocks_target(blockedUserId),
  FOREIGN KEY(ownerId) REFERENCES users(id),
  FOREIGN KEY(blockedUserId) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
