-- Round 21 (2026-11-27): city on reviews, so review cards can show where
-- the customer is from (e.g. "Ayesha — Lahore"). One-time run:
--   npx wrangler d1 execute giftwala-db --remote
--     --file=migrations/0014_reviews_city.sql
-- The Worker falls back gracefully if this has not been applied yet
-- (reviews are still accepted and listed, just without a city).
ALTER TABLE reviews ADD COLUMN city TEXT NOT NULL DEFAULT '';
