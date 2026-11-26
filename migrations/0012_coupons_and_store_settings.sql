-- 0012_coupons_and_store_settings.sql
-- Coupons + store settings tables for the GiftWALA admin panel.
--
-- IMPORTANT — READ BEFORE DEPLOYING:
-- This migration creates D1 TABLES ONLY. It does NOT create any Worker
-- endpoint, and no endpoint was invented here. Until a Worker endpoint for
-- /api/coupons is deployed (GET/POST/DELETE), the admin Coupons tab shows
-- "not yet enabled on server" and no coupon is live — the table existing
-- does NOT make coupons work. The same applies to store_settings: the
-- admin panel reads/writes those values through the EXISTING
-- /api/admin/builder-settings endpoint until a dedicated settings endpoint
-- is deployed. The checkout must also be wired to validate coupon codes
-- against this table; a code in this table alone gives no discount.
--
-- Run once with: wrangler d1 migrations apply <DB_NAME> --local (test first)
-- then without --local for production. Do NOT re-run blindly: the
-- ALTER TABLE below has no IF NOT EXISTS guard (SQLite does not support
-- one for ADD COLUMN) and will fail on a second run.

-- Coupons: code, percent or flat value, optional minimum order and expiry.
CREATE TABLE IF NOT EXISTS coupons (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('percent', 'flat')),
  value REAL NOT NULL CHECK (value > 0),
  min_order REAL NOT NULL DEFAULT 0,
  expires_at INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons (code);

-- Store settings (key/value). Mirrors builder_settings on purpose: it is
-- the namespaced home for delivery/contact/page settings once a dedicated
-- settings endpoint exists. Until then the admin panel uses the existing
-- builder-settings endpoint and these rows are defaults only.
CREATE TABLE IF NOT EXISTS store_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Defaults below come from the owner's brief — no prices were invented.
-- deliveryCharge Rs. 300 is the flat delivery charge (owner decision,
-- 25 Nov 2026).
INSERT OR IGNORE INTO store_settings (key, value) VALUES
  ('deliveryCharge', '300'),
  ('whatsappNumber', '+92 301 074 6622'),
  ('supportEmail', 'hello@giftwala.pk'),
  ('announcementBar', '');

-- Review moderation status. The Worker does NOT read this column yet, so
-- approve/reject in the admin panel is stored in the browser only until a
-- review-status endpoint is deployed that selects/filters on it.
-- (Run once only — see the note at the top of this file.)
ALTER TABLE reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
