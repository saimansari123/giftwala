-- Round 20 (2026-11-27): store the full order breakdown + customer
-- details so admin and Track Order show exactly what the customer paid.
-- One-time run: npx wrangler d1 execute giftwala-db --remote
--   --file=migrations/0013_order_breakdown.sql
-- The Worker falls back to the old columns if this has not been applied.
ALTER TABLE orders ADD COLUMN city TEXT;
ALTER TABLE orders ADD COLUMN message TEXT;
ALTER TABLE orders ADD COLUMN payment_reference TEXT;
ALTER TABLE orders ADD COLUMN subtotal INTEGER;
ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 300;
