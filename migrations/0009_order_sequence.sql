CREATE TABLE IF NOT EXISTS order_sequence (
  key TEXT PRIMARY KEY,
  next_number INTEGER DEFAULT 1
);

INSERT OR IGNORE INTO order_sequence (key, next_number) VALUES ('order_id', 1);
