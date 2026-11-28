// SECURITY (2026-11-25) — response headers.
// Every API response (via json()) and every static-asset response (via
// withSecurityHeaders()) carries these headers.
// CSP NOTE: script-src / style-src keep 'unsafe-inline' because the
// storefront still relies on inline <script> blocks and inline event
// handlers (see SECURITY-SETUP.md). Tightening that requires moving all
// inline JS/CSS out of the HTML pages first — a separate job, not this one.
// Until then the CSP still blocks framing, plugins, and off-origin loads
// other than images/fonts (Google Fonts + Drive thumbnails are allowlisted).
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; media-src 'self' data:",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

// SECURITY (2026-11-25): re-wrap any Response (e.g. static assets from
// env.ASSETS.fetch) with the security headers, keeping status/body intact.
function withSecurityHeaders(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json;charset=UTF-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization',
    ...SECURITY_HEADERS,
    ...extraHeaders
  }
});

const body = async req => {
  try { return await req.json(); }
  catch { return {}; }
};

const token = req => String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

const imageDataPattern = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/]+={0,2})$/i;
function imageResponse(data) {
  const match = imageDataPattern.exec(data || '');
  if (!match) return json({ message: 'Image not found' }, 404);
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); }
  catch { return json({ message: 'Invalid image data' }, 422); }
  return new Response(bytes, {
    headers: { 'content-type': match[1], 'cache-control': 'no-cache' }
  });
}

const cleanText = v => String(v ?? '').replace(/â€"|â€"|â€œ|â€|Â|&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// SECURITY (2026-11-25) — input sanitising / validation helpers.
// Strategy: sanitise on WRITE (strip HTML tags + stray < > from anything a
// visitor or admin types, so the DB only ever holds plain text), and escape
// on RENDER in the frontend (see reviews-ui.js / script.js /
// product-gallery.js). The API returns JSON, so it must NOT HTML-escape on
// output — that would double-escape once the frontend escapes too.
// ---------------------------------------------------------------------------
const MAX_JSON_BYTES = 8 * 1024 * 1024; // uploads allow 7 MB base64 + overhead

// Strip HTML tags and any leftover < > (catches "<<script>" style smuggling),
// drop control characters (keeps tab/newline), trim, enforce a max length.
const sanitizeText = (v, max = 500) => {
  let s = String(v ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
};

// Image URLs: allow site-relative paths, http(s) URLs, data:image base64 and
// bare filenames. Reject javascript:/vbscript:/data:text/html schemes and
// values containing quote/angle characters (attribute break-out).
const sanitizeImageUrl = (v, max = 2000) => {
  const s = String(v ?? '').trim();
  if (s.startsWith('data:image/')) return s.length <= 1_500_000 && imageDataPattern.test(s) ? s : '';
  if (!s || s.length > max) return '';
  if (/^\s*(javascript|vbscript|data:text\/html)\s*:/i.test(s)) return '';
  if (/["'<>]/.test(s)) return '';
  return s;
};

const asObject = b => (b && typeof b === 'object' && !Array.isArray(b) ? b : null);
const validInt = (v, min, max) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const validNum = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
// SKUs in this store look like GW-GB-001: letters/digits/dot/dash/underscore.
const validSku = v => {
  const s = sanitizeText(v, 100);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s) ? s : null;
};


const productOut = p => {
  if (!p) return p;
  let images = [], sizes = [];
  try { images = JSON.parse(p.images || '[]'); } catch { images = p.images ? [String(p.images)] : []; }
  try { sizes = JSON.parse(p.sizes || '[]'); } catch { sizes = []; }
  return {
    ...p,
    name: cleanText(p.name),
    description: cleanText(p.description),
    salePrice: p.sale_price,
    imageUrl: sanitizeImageUrl(p.image_url),
    cardImage: sanitizeImageUrl(p.card_image_url),
    images,
    sizes,
    createdAt: p.created_at
  };
};

const productIdLookup = 'COALESCE((SELECT id FROM products WHERE id=?), (SELECT id FROM products WHERE sku=?))';
const VALID_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
// Payment methods exactly as checkout.html offers them. Anything else is rejected.
const VALID_PAYMENT_METHODS = ['Cash on Delivery', 'Easypaisa - 15% off prepaid', 'JazzCash - 15% off prepaid', 'Bank Transfer - 15% off prepaid'];
/* ROUND 20 (G11): accept 03xxxxxxxxx and +92 3xxxxxxxxx, normalise to
   +92 form. Validates digit count 10 (03...) or 12 (92...), and that
   the mobile starts with 03 / 923. */
function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/[^\d+]/g, '');
  if (/^\+?92[0-9]{10}$/.test(digits)) return '+92' + digits.replace(/^\+?92/, '');
  if (/^03[0-9]{9}$/.test(digits)) return '+92' + digits.slice(1);
  return null;
}

// SECURITY (2026-11-25) — rate limits (per IP, in-memory).
// Limits: 5 reviews / 24h (unchanged from before), 10 orders / hour,
// 5 failed admin logins / 15 min. The store is a plain Map, so limits are
// approximate: they reset when the Worker isolate restarts / is evicted,
// and each isolate tracks its own counts. That is acceptable for abuse
// throttling here; a D1-backed limiter would be needed for exact global
// counts, and would cost a DB write on every public POST.
const REVIEW_RATE_LIMIT = 5, REVIEW_WINDOW_MS = 86400000; // 5 / 24h
const ORDER_RATE_LIMIT = 10, ORDER_WINDOW_MS = 3600000;   // 10 / hour
const LOGIN_RATE_LIMIT = 5, LOGIN_WINDOW_MS = 900000;      // 5 failures / 15 min
const rateLimitStore = new Map(); // key -> [timestamps]; reset on Worker restart

function pruneRateLimit(key, windowMs, now) {
  const kept = (rateLimitStore.get(key) || []).filter(t => now - t < windowMs);
  if (kept.length) rateLimitStore.set(key, kept);
  else rateLimitStore.delete(key);
  return kept;
}
// Returns true and records the attempt, or false when the limit is hit.
function rateLimitAllow(key, limit, windowMs) {
  const now = Date.now();
  const kept = pruneRateLimit(key, windowMs, now);
  if (kept.length >= limit) return false;
  kept.push(now);
  rateLimitStore.set(key, kept);
  // Opportunistic cleanup so one hot keyspace cannot grow the Map forever.
  if (rateLimitStore.size > 5000) {
    for (const [k, v] of rateLimitStore) {
      if (!v.some(t => now - t < REVIEW_WINDOW_MS)) rateLimitStore.delete(k);
    }
  }
  return true;
}
// Peek without recording (login: only FAILED attempts consume the bucket).
function rateLimitExceeded(key, limit, windowMs) {
  return pruneRateLimit(key, windowMs, Date.now()).length >= limit;
}
function rateLimitRecord(key, windowMs) {
  const now = Date.now();
  const kept = pruneRateLimit(key, windowMs, now);
  kept.push(now);
  rateLimitStore.set(key, kept);
}

// SECURITY (2026-11-25) — admin auth.
// Secrets live ONLY in Cloudflare env/secrets (wrangler secret put) — never
// in code, never in the repo. See SECURITY-SETUP.md.
// Hardened vs the old code:
//  - If ANY of ADMIN_TOKEN / ADMIN_EMAIL / ADMIN_PASSWORD is unset, every
//    admin endpoint returns 401. The old login compared String(env.X),
//    so with an unset secret the literal password "undefined" would match.
//  - Comparisons are constant-time-ish (no early exit on first mismatch).
function adminConfigured(env) {
  return Boolean(env.ADMIN_TOKEN && env.ADMIN_EMAIL && env.ADMIN_PASSWORD);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function admin(req, env) {
  if (!adminConfigured(env)) return json({ message: 'Admin login required' }, 401);
  const t = token(req);
  if (!t || !timingSafeEqual(t, env.ADMIN_TOKEN)) return json({ message: 'Admin login required' }, 401);
  return null;
}

function getClientIP(req) {
  return req.headers.get('cf-connecting-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
         'unknown';
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // CORS Preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'Content-Type, Authorization',
          ...SECURITY_HEADERS
        }
      });
    }

    // SECURITY (2026-11-25): reject oversized JSON bodies before parsing.
    // The image-upload endpoint accepts up to 7 MB of base64, so the cap is
    // 8 MB; every other endpoint is far smaller. A missing Content-Length
    // (chunked upload) cannot be checked up front — see SECURITY-SETUP.md.
    if ((req.method === 'POST' || req.method === 'PATCH') && req.headers.get('content-length')) {
      const len = Number(req.headers.get('content-length'));
      if (Number.isFinite(len) && len > MAX_JSON_BYTES) {
        return json({ message: 'Request body too large' }, 413);
      }
    }

    // Legacy builder data endpoint used by the homepage.
    if (url.pathname === '/server/sheet-products.json' && req.method === 'GET') {
      const r = await env.DB.prepare(
        'SELECT id,name,sku,category,price,sale_price,stock,description,image_url,featured,created_at,sizes FROM (SELECT id,name,sku,category,price,sale_price,stock,description,image_url,featured,created_at,sizes,ROW_NUMBER() OVER (PARTITION BY category ORDER BY featured DESC, created_at DESC, sku ASC) AS category_rank FROM products WHERE (hidden IS NULL OR hidden = 0)) WHERE category_rank=1 ORDER BY featured DESC, created_at DESC, sku ASC'
      ).all();
      return json((r.results || []).map(productOut));
    }

    // Static files — SECURITY (2026-11-25): same security headers as the API.
    if (!url.pathname.startsWith('/api/')) return withSecurityHeaders(await env.ASSETS.fetch(req));

    // Database check
    if (!env.DB) return json({ message: 'Database not configured' }, 503);

    // SECURITY (2026-11-25): FIRST admin layer — explicit guard. Every
    // /api/admin/* route except the login itself requires a valid admin
    // token, wherever the route is defined below, so a future route added
    // above the second (choke-point) guard can never slip through
    // unauthenticated. Product create/update/delete/hide and order-status
    // routes are additionally behind that choke-point guard below.
    if (url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/login') {
      const check = await admin(req, env);
      if (check) return check;
    }

    try {
      // Health check
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'GiftWALA API' });
      }

      // Admin login.
      // SECURITY (2026-11-25): 401 (never 200/500) when the admin secrets
      // are not configured — the old String(env.X) comparison let the
      // literal password "undefined" match an unset ADMIN_PASSWORD. Only
      // FAILED attempts consume the login rate limit, and the failure
      // message never says whether the email or the password was wrong.
      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        const ip = getClientIP(req);
        const loginKey = `login_${ip}`;
        if (rateLimitExceeded(loginKey, LOGIN_RATE_LIMIT, LOGIN_WINDOW_MS)) {
          return json({ message: 'Too many login attempts. Try again later.' }, 429, { 'Retry-After': '900' });
        }
        const b = asObject(await body(req));
        if (!adminConfigured(env)) return json({ message: 'Admin login is not configured' }, 401);
        const email = typeof b?.email === 'string' ? b.email.trim() : '';
        const password = typeof b?.password === 'string' ? b.password : '';
        if (!email || !password || email.length > 200 || password.length > 200 ||
            !timingSafeEqual(email, env.ADMIN_EMAIL) ||
            !timingSafeEqual(password, env.ADMIN_PASSWORD)) {
          rateLimitRecord(loginKey, LOGIN_WINDOW_MS);
          return json({ message: 'Invalid credentials' }, 401);
        }
        return json({ token: env.ADMIN_TOKEN, email: env.ADMIN_EMAIL });
      }

      // Get single product
      const singleProduct = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (singleProduct && req.method === 'GET') {
        const key = decodeURIComponent(singleProduct[1]);
        if (!key || key.length > 200) return json({ message: 'Product not found' }, 404);
        const p = await env.DB.prepare(
          `SELECT * FROM products WHERE id=${productIdLookup} AND COALESCE(hidden,0)=0`
        ).bind(key, key).first();
        return p ? json(productOut(p)) : json({ message: 'Product not found' }, 404);
      }

      // Health check
      if (url.pathname === '/api/health' && req.method === 'GET') {
        try {
          const test = await env.DB.prepare('SELECT COUNT(*) count FROM products').first();
          return json({ ok: true, products: test.count });
        } catch (e) {
          return json({ ok: false, error: String(e) }, 500);
        }
      }

      // Public product detail includes the optional gallery images. The list
      // endpoint intentionally stays lightweight so the storefront loads fast.
      const publicProduct = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (publicProduct && req.method === 'GET') {
        const key = decodeURIComponent(publicProduct[1]);
        const r = await env.DB.prepare(
          "SELECT id,name,sku,category,price,sale_price,stock,description,CASE WHEN image_url LIKE 'data:image/%' THEN '/api/product-images/' || id ELSE image_url END AS image_url,CASE WHEN card_image_url <> '' THEN '/api/product-images/' || id || '/card' ELSE '' END AS card_image_url,images,featured,created_at,sizes FROM products WHERE (id=? OR sku=?) AND (hidden IS NULL OR hidden=0) LIMIT 1"
        ).bind(key, key).first();
        return r ? json(productOut(r)) : json({ message: 'Product not found' }, 404);
      }

      // List products (public)
      if (url.pathname === '/api/products' && req.method === 'GET') {
        try {
          const q = url.searchParams.get('category');
          if (q && q.length > 100) return json({ message: 'Invalid category' }, 400);
          const search = url.searchParams.get('search') === '1';
          if (search) {
            const r = await env.DB.prepare(
              "SELECT id,name,sku,category,price,sale_price FROM products WHERE (hidden IS NULL OR hidden = 0) ORDER BY featured DESC, created_at DESC, sku ASC"
            ).all();
            return json((r.results || []).map(p => ({ id:p.id, name:cleanText(p.name), sku:p.sku, category:cleanText(p.category), price:p.price, salePrice:p.sale_price })));
          }
          const home = url.searchParams.get('home') === '1';
          const fields = "id,name,sku,category,price,sale_price,stock,description,CASE WHEN image_url LIKE 'data:image/%' THEN '/api/product-images/' || id ELSE image_url END AS image_url,CASE WHEN card_image_url <> '' THEN '/api/product-images/' || id || '/card' ELSE '' END AS card_image_url,featured,created_at,sizes";
          // SAFE-FIX (2026-11-25): public list hides hidden products, orders
          // deterministically (featured DESC, created_at DESC, sku ASC — the
          // sku tie-break stops prices/products shuffling between loads), and
          // the no-param branch returns the FULL list. Previously home and
          // no-param were identical and both capped at 4 per category, so
          // /api/products never returned the full catalogue.
          const visible = "(hidden IS NULL OR hidden = 0)";
          const query = q
            ? `SELECT ${fields} FROM products WHERE category=? AND ${visible} ORDER BY featured DESC, created_at DESC, sku ASC`
            : home
              ? `SELECT ${fields} FROM (SELECT ${fields}, ROW_NUMBER() OVER (PARTITION BY category ORDER BY featured DESC, created_at DESC, sku ASC) AS category_rank FROM products WHERE ${visible}) WHERE category_rank <= 4 ORDER BY featured DESC, created_at DESC, sku ASC`
              : `SELECT ${fields} FROM products WHERE ${visible} ORDER BY featured DESC, created_at DESC, sku ASC`;
          const r = await env.DB.prepare(query).bind(...(q ? [q] : [])).all();
          const results = r.results || [];
          return json(results.length ? results.map(productOut) : []);
        } catch (e) {
          return json({ ok: false, message: String(e.message || e) }, 500);
        }
      }

      // List all products (admin only - includes hidden)
      if (url.pathname === '/api/admin/products' && req.method === 'GET') {
        const check = await admin(req, env);
        if (check) return check;

        const q = url.searchParams.get('category');
        const r = await env.DB.prepare(
          `SELECT id,name,sku,category,price,sale_price,stock,description,
                  CASE WHEN image_url LIKE 'data:image/%' THEN '/api/product-images/' || id ELSE image_url END AS image_url,
                  featured,created_at,sizes,hidden
           FROM products ${q ? 'WHERE category=?' : ''}
           ORDER BY featured DESC, created_at DESC, sku ASC`
        ).bind(...(q ? [q] : [])).all();
        return json(r.results.map(productOut));
      }

      const productImage = url.pathname.match(/^\/api\/product-images\/([^/]+)(\/card)?$/);
      if (productImage && req.method === 'GET') {
        const column = productImage[2] ? 'card_image_url' : 'image_url';
        const row = await env.DB.prepare(`SELECT ${column} AS image FROM products WHERE id=?`)
          .bind(decodeURIComponent(productImage[1])).first();
        return imageResponse(row?.image);
      }

      // List categories
      if (url.pathname === '/api/categories' && req.method === 'GET') {
        const r = await env.DB.prepare(
          'SELECT name FROM categories UNION SELECT DISTINCT category AS name FROM products ORDER BY name'
        ).all();
        return json(r.results.map(x => x.name));
      }

      // Get builder settings
      if (url.pathname === '/api/builder-settings' && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT key,value FROM builder_settings').all();
        return json(Object.fromEntries(r.results.map(x => [x.key, x.value])));
      }

      // List reviews.
      // SECURITY (2026-11-25): stored values are sanitised on write (see
      // POST below); output is sanitised again here so reviews written
      // before this fix cannot reach the page unescaped either. The
      // frontend still escapes on render — defence in depth, not a substitute.
      // ROUND 21 (2026-11-27): real reviews loop. Public callers see
      // APPROVED reviews only. Admin (valid token + ?all=1) sees every
      // review with its moderation status. `city` comes from migration
      // 0014 and `status` from migration 0012; if either has not been
      // applied yet the query falls back to the columns that exist, so
      // the endpoint never 500s on an older DB.
      if (url.pathname === '/api/reviews' && req.method === 'GET') {
        const wantAll = url.searchParams.get('all') === '1';
        if (wantAll) { const g = await admin(req, env); if (g) return g; }
        const mapRows = (rows, withStatus) => (rows || []).map(x => ({
          id: x.id,
          name: sanitizeText(x.name, 100),
          city: sanitizeText(x.city || '', 80),
          comment: sanitizeText(x.comment, 2000),
          rating: Math.max(1, Math.min(5, Number(x.rating) || 5)),
          createdAt: x.createdAt,
          productId: x.productId,
          productName: sanitizeText(x.productName, 200),
          status: withStatus && ['approved', 'rejected', 'pending'].includes(x.status) ? x.status : (withStatus ? 'pending' : 'approved')
        }));
        const where = wantAll ? '' : " WHERE status='approved'";
        try {
          const r = await env.DB.prepare(
            `SELECT id,name,city,comment,rating,created_at AS createdAt,product_id AS productId,product_name AS productName,status FROM reviews${where} ORDER BY created_at DESC`
          ).all();
          return json(mapRows(r.results, true));
        } catch (e) {
          try {
            // Migration 0014 (city) not applied yet: retry without city.
            const r = await env.DB.prepare(
              `SELECT id,name,comment,rating,created_at AS createdAt,product_id AS productId,product_name AS productName,status FROM reviews${where} ORDER BY created_at DESC`
            ).all();
            return json(mapRows(r.results, true));
          } catch (e2) {
            // Migration 0012 (status) not applied yet: every stored review
            // was public before moderation existed, so treat as approved.
            const r = await env.DB.prepare(
              'SELECT id,name,comment,rating,created_at AS createdAt,product_id AS productId,product_name AS productName FROM reviews ORDER BY created_at DESC'
            ).all();
            return json(mapRows(r.results, false));
          }
        }
      }

      // Create review (with rate limiting).
      // SECURITY (2026-11-25): 5 reviews / IP / 24h (unchanged limit);
      // rating must be a whole number 1-5 (the old code coerced any input,
      // so rating 0 silently became 1); name/comment/product are HTML-
      // stripped and length-capped before storage.
      if (url.pathname === '/api/reviews' && req.method === 'POST') {
        const ip = getClientIP(req);
        if (!rateLimitAllow(`review_${ip}`, REVIEW_RATE_LIMIT, REVIEW_WINDOW_MS)) {
          return json({ message: 'Too many reviews. Try again later.' }, 429, { 'Retry-After': '86400' });
        }

        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const name = sanitizeText(b.name, 100);
        const comment = sanitizeText(b.comment, 2000);
        const rating = validInt(b.rating, 1, 5);
        const productId = sanitizeText(b.productId, 100);
        const productName = sanitizeText(b.productName, 200);
        const city = sanitizeText(b.city, 80);

        if (!name || !comment || rating === null) {
          return json({ message: 'Name, review and a rating from 1 to 5 are required' }, 400);
        }

        // ROUND 21 (2026-11-27): new reviews start as 'pending' — they
        // appear on the storefront only after an admin approves them.
        const id = crypto.randomUUID();
        const inserted = async (withCity, withStatus) => {
          const cols = ['id', 'name', ...(withCity ? ['city'] : []), 'comment', 'rating', 'created_at', 'product_id', 'product_name', ...(withStatus ? ['status'] : [])];
          const vals = [id, name, ...(withCity ? [city] : []), comment, rating, Date.now(), productId || null, productName || null, ...(withStatus ? ['pending'] : [])];
          await env.DB.prepare(
            'INSERT INTO reviews (' + cols.join(',') + ') VALUES (' + vals.map(() => '?').join(',') + ')'
          ).bind(...vals).run();
        };
        try { await inserted(true, true); }
        catch (e) {
          try { await inserted(false, true); }
          catch (e2) { await inserted(false, false); }
        }

        return json({ id, name, city, comment, rating, productId, productName, status: 'pending' }, 201);
      }

      // Get category settings
      if (url.pathname === '/api/category-settings' && req.method === 'GET') {
        const r = await env.DB.prepare(
          "SELECT key,value FROM builder_settings WHERE key LIKE 'categoryImage:%'"
        ).all();
        return json(Object.fromEntries(r.results.map(x => [x.key.replace('categoryImage:', ''), x.value])));
      }

      // Get category descriptions
      if (url.pathname === '/api/category-descriptions' && req.method === 'GET') {
        const r = await env.DB.prepare(
          "SELECT key,value FROM builder_settings WHERE key LIKE 'categoryDescription:%'"
        ).all();
        return json(Object.fromEntries(r.results.map(x => [x.key.replace('categoryDescription:', ''), x.value])));
      }

      // Create order (WITH PRODUCT VALIDATION).
      // SECURITY (2026-11-25): 10 orders / IP / hour; customer fields are
      // HTML-stripped and length-capped; phone must look like a phone
      // number; email (optional) must look like an email; payment method
      // must be one checkout.html actually offers. Items are REBUILT from
      // the DB — the client-sent name/price are discarded, so a tampered
      // cart can neither rename a product nor change its price (the total
      // already used the DB price; the stored items now do too).
      if (url.pathname === '/api/orders' && req.method === 'POST') {
        const ip = getClientIP(req);
        if (!rateLimitAllow(`order_${ip}`, ORDER_RATE_LIMIT, ORDER_WINDOW_MS)) {
          return json({ message: 'Too many orders. Try again later.' }, 429, { 'Retry-After': '3600' });
        }

        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const customer = asObject(b.customer);
        if (!customer) return json({ message: 'Customer and order details required' }, 400);
        const custName = sanitizeText(customer.name, 100);
        const custPhone = normalizePhone(customer.phone);
        const custEmail = sanitizeText(customer.email, 200);
        const custCity = sanitizeText(customer.city, 80);
        const custAddress = sanitizeText(customer.address, 500);
        const custMessage = sanitizeText(b.message, 500);
        const paymentReference = sanitizeText(b.paymentReference, 100);
        const paymentMethod = b.paymentMethod === undefined || b.paymentMethod === null
          ? 'Cash on Delivery' : sanitizeText(b.paymentMethod, 100);
        if (!custName || !custAddress || !custPhone) {
          return json({ message: 'Please enter your name, a valid Pakistani mobile number (03xxxxxxxxx or +92 3xxxxxxxxx) and delivery address' }, 400);
        }
        if (custEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(custEmail)) {
          return json({ message: 'Invalid email address' }, 400);
        }
        if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
          return json({ message: 'Invalid payment method' }, 400);
        }
        if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) {
          return json({ message: 'Customer and order details required' }, 400);
        }

        // Validate items against products in DB, rebuilding each item from DB data.
        let total = 0;
        const cleanItems = [], quantities = new Map();
        for (const rawItem of b.items) {
          const item = asObject(rawItem);
          if (!item) return json({ message: 'Invalid order item' }, 400);
          const sku = sanitizeText(item.sku, 100);
          const quantity = validInt(item.quantity, 1, 99);
          if (!sku || quantity === null) {
            return json({ message: 'Invalid item quantity' }, 400);
          }

          const product = await env.DB.prepare(
            `SELECT id, sku, name, price, sale_price, stock FROM products WHERE id=${productIdLookup} AND COALESCE(hidden,0)=0`
          ).bind(sku, sku).first();

          if (!product) {
            return json({ message: `Product ${sku} not found` }, 404);
          }

          const reserved = (quantities.get(product.id) || 0) + quantity;
          if (product.stock < reserved) {
            return json({ message: `Insufficient stock for ${sku}` }, 400);
          }

          // Use DB price, not client price
          const price = product.sale_price || product.price;
          total += price * quantity;
          quantities.set(product.id, reserved);
          const line = { productId:product.id, sku:product.sku, name: cleanText(product.name), quantity, price };
          /* ROUND 20 (G4): personalisation is stored with the order line
             so the admin and the customer see what was customised. */
          if (item.person) line.personalization = sanitizeText(item.person, 200);
          if (item.photo) line.photo = sanitizeText(item.photo, 200);
          if (item.frameSize) line.frameSize = sanitizeText(item.frameSize, 50);
          if (item.size) line.size = sanitizeText(item.size, 50);
          if (item.occasion) line.occasion = sanitizeText(item.occasion, 100);
          if (item.note) line.note = sanitizeText(item.note, 500);
          if (item.message) line.giftNote = sanitizeText(item.message, 500);
          cleanItems.push(line);
        }

        /* ROUND 20 (G2): the full breakdown is computed server-side
           from DB prices and stored, so admin and Track Order show exactly
           what the customer paid. Prepaid methods (Easypaisa/JazzCash/bank)
           get the 15% discount; delivery is a flat Rs. 300 on a non-empty
           order. */
        const subtotal = total;
        const prepaid = paymentMethod !== 'Cash on Delivery';
        const discount = prepaid ? Math.round(subtotal * 0.15) : 0;
        const deliveryFee = 300;
        total = subtotal - discount + deliveryFee;

        const inventory = JSON.stringify(Array.from(quantities, ([id, quantity]) => ({ id, quantity })));
        const saved = await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO order_sequence (key,next_number) VALUES ('order_id',1)"),
          env.DB.prepare(`
            INSERT INTO orders (id,customer_name,phone,email,city,address,message,payment_method,payment_reference,items,subtotal,discount,delivery_fee,total,status,created_at)
            SELECT printf('GW-%05d', MAX(next_number,
              COALESCE((SELECT MAX(CAST(substr(id,4) AS INTEGER)) + 1 FROM orders WHERE id GLOB 'GW-[0-9]*'),1)
            )), ?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending', ?
            FROM order_sequence WHERE key='order_id'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) requested LEFT JOIN products p ON p.id=json_extract(requested.value,'$.id')
              WHERE p.id IS NULL OR COALESCE(p.hidden,0)<>0 OR p.stock IS NULL OR p.stock<json_extract(requested.value,'$.quantity')
            )
            RETURNING id
          `).bind(custName,custPhone,custEmail,custCity,custAddress,custMessage,paymentMethod,paymentReference,JSON.stringify(cleanItems),subtotal,discount,deliveryFee,total,Date.now(),inventory),
          env.DB.prepare(`
            UPDATE products SET stock=stock-json_extract(requested.value,'$.quantity')
            FROM json_each(?) requested WHERE changes()>0 AND products.id=json_extract(requested.value,'$.id')
          `).bind(inventory),
          env.DB.prepare("UPDATE order_sequence SET next_number=(SELECT MAX(CAST(substr(id,4) AS INTEGER))+1 FROM orders WHERE id GLOB 'GW-[0-9]*') WHERE key='order_id' AND changes()>0")
        ]);
        const id = saved[1].results[0]?.id;
        if (!id) return json({ message: 'Stock changed. Please review the cart and try again.' }, 409);
        return json({ _id: id, total, subtotal, discount, deliveryFee, status: 'pending' }, 201);
      }

      // Get order by ID
      const orderById = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderById && req.method === 'GET') {
        const orderId = decodeURIComponent(orderById[1]);
        if (!orderId || orderId.length > 100) return json({ message: 'Order not found' }, 404);
        const order = await env.DB.prepare(
          'SELECT id AS _id,id,status,total,subtotal,discount,delivery_fee,items FROM orders WHERE id=?'
        ).bind(orderId).first();
        if (!order) return json({ message: 'Order not found' }, 404);
        const items = JSON.parse(order.items || '[]');
        order.items = JSON.stringify(items.map(({name,quantity,price,sku}) => ({name,quantity,price,sku})));
        return json(order);
      }

      // Admin routes — SECOND admin layer (choke point).
      // SECURITY (2026-11-25): everything below this line requires a valid
      // admin token: review/media deletion, image upload, builder/category
      // settings, product create/update/delete/hide, category create/rename,
      // order listing and order-status changes. Keep all product mutations
      // and /api/admin/* routes BELOW this guard; the explicit /api/admin/*
      // guard near the top of fetch() is the first layer. If the admin
      // secrets are unset, admin() returns 401 here too (see SECURITY-SETUP.md).
      const guard = await admin(req, env);
      if (guard) return guard;

      const adminProduct = url.pathname.match(/^\/api\/admin\/products\/([^/]+)$/);
      if (adminProduct && req.method === 'GET') {
        const key = decodeURIComponent(adminProduct[1]);
        const product = await env.DB.prepare(`SELECT * FROM products WHERE id=${productIdLookup}`).bind(key,key).first();
        return product ? json(productOut(product)) : json({ message: 'Product not found' }, 404);
      }

      // Delete review
      const rm = url.pathname.match(/^\/api\/reviews\/([^/]+)$/);
      if (rm && req.method === 'DELETE') {
        if (!rm[1] || rm[1].length > 200) return json({ message: 'Review not found' }, 404);
        await env.DB.prepare('DELETE FROM reviews WHERE id=?').bind(rm[1]).run();
        return json({ ok: true });
      }

      // ROUND 21 (2026-11-27): approve / reject a review (admin only).
      // Body: { status: 'approved' | 'rejected' }. Only 'approved'
      // reviews are returned by public GET /api/reviews, so this is the
      // step that puts a real customer review on the storefront.
      if (rm && req.method === 'PATCH') {
        if (!rm[1] || rm[1].length > 200) return json({ message: 'Review not found' }, 404);
        const b = asObject(await body(req));
        const st = b && (b.status === 'approved' || b.status === 'rejected') ? b.status : null;
        if (!st) return json({ message: 'status must be approved or rejected' }, 400);
        const cur = await env.DB.prepare('SELECT id FROM reviews WHERE id=?').bind(rm[1]).first();
        if (!cur) return json({ message: 'Review not found' }, 404);
        await env.DB.prepare('UPDATE reviews SET status=? WHERE id=?').bind(st, rm[1]).run();
        return json({ ok: true, id: rm[1], status: st });
      }

      // Upload image (base64 - TODO: migrate to R2)
      if (url.pathname === '/api/uploads/image' && req.method === 'POST') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const data = String(b.data || '');
        // SECURITY (2026-11-25): filename is stripped of path separators
        // and special characters so it can never escape the media store
        // (e.g. "../../x") or break out of an attribute when rendered.
        const filename = String(b.filename || 'image').replace(/[\/\?%*:|"<>]/g, '').trim().slice(0, 200) || 'image';
        const sku = sanitizeText(b.sku, 100);

        if (!sku) return json({ message: 'SKU required' }, 400);
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data)) {
          return json({ message: 'Send a PNG, JPG or WEBP image' }, 400);
        }
        if (data.length > 1_500_000) {
          return json({ message: 'Encoded image is too large. Resize it and try again.' }, 413);
        }

        const id = crypto.randomUUID();
        try {
          await env.DB.prepare(
            'INSERT INTO media (id, sku, filename, image_data, created_at) VALUES (?, ?, ?, ?, datetime("now"))'
          ).bind(id, sku, filename, data).run();

          return json({ ok: true, id, sku, filename }, 201);
        } catch (e) {
          return json({ message: 'Failed to store image: ' + e.message }, 500);
        }
      }

      if (url.pathname === '/api/media' && req.method === 'GET') {
        const result = await env.DB.prepare(
          'SELECT id,sku,filename FROM media ORDER BY created_at DESC'
        ).all();
        return json(result.results);
      }

      const mediaImage = url.pathname.match(/^\/api\/media\/([^/]+)\/image$/);
      if (mediaImage && req.method === 'GET') {
        const row = await env.DB.prepare('SELECT image_data FROM media WHERE id=?')
          .bind(decodeURIComponent(mediaImage[1])).first();
        return imageResponse(row?.image_data);
      }

      // Get media by SKU
      if (url.pathname.startsWith('/api/media/') && req.method === 'GET') {
        const sku = decodeURIComponent(url.pathname.slice('/api/media/'.length)).trim();
        if (!sku || sku.length > 200) return json({ message: 'SKU required' }, 400);

        try {
          const r = await env.DB.prepare(
            'SELECT * FROM media WHERE sku = ? ORDER BY created_at DESC'
          ).bind(sku).all();

          return json({ ok: true, images: r.results || [] });
        } catch (e) {
          return json({ message: 'Failed to retrieve media: ' + e.message }, 500);
        }
      }

      // Delete media by ID
      if (url.pathname.startsWith('/api/media/') && req.method === 'DELETE') {
        const imgId = decodeURIComponent(url.pathname.slice('/api/media/'.length)).trim();
        if (!imgId || imgId.length > 200) return json({ message: 'Image ID required' }, 400);

        try {
          const result = await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(imgId).run();
          if (!result.meta.changes) return json({ message: 'Image not found' }, 404);
          return json({ ok: true });
        } catch (e) {
          return json({ message: 'Failed to delete media: ' + e.message }, 500);
        }
      }

      // Update builder settings
      // SECURITY (2026-11-25): keys must match a safe charset (no
      // arbitrary keys), values must be strings within a length cap and are
      // HTML-stripped; category-image values are URL-sanitised instead.
      if (url.pathname === '/api/admin/builder-settings' && req.method === 'PATCH') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        for (const [key, value] of Object.entries(b)) {
          if (!/^[A-Za-z0-9:_-]{1,100}$/.test(key)) return json({ message: 'Invalid setting key' }, 400);
          if (typeof value !== 'string' || value.length > 10000) return json({ message: 'Invalid setting value' }, 400);
          const cleanValue = key.startsWith('categoryImage:') ? sanitizeImageUrl(value) : sanitizeText(value, 10000);
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(key, cleanValue).run();
        }
        return json({ ok: true });
      }

      // Update category settings
      if (url.pathname === '/api/admin/category-settings' && req.method === 'PATCH') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const name = sanitizeText(b.name, 100);
        if (!name) return json({ message: 'Category name required' }, 400);

        if (Object.prototype.hasOwnProperty.call(b, 'image')) {
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind('categoryImage:' + name, sanitizeImageUrl(b.image)).run();
        }

        if (Object.prototype.hasOwnProperty.call(b, 'description')) {
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind('categoryDescription:' + name, sanitizeText(b.description, 2000)).run();
        }

        return json({ ok: true });
      }

      // Create product
      // SAFE-FIX (2026-11-25): a missing/invalid price used to be silently
      // stored as Rs. 0. Reject it instead — a product must never be created
      // with a Rs. 0 price by accident. salePrice still defaults to price
      // when omitted (existing admin behaviour).
      // SECURITY (2026-11-25): full server-side validation — the old code
      // only checked the price and stored every other field raw, and echoed
      // the raw request body back in the response. Now: required fields,
      // HTML-stripped text with length caps, SKU charset, integer stock
      // >= 0, sanitised image URLs / sizes, and the response returns only
      // the sanitised stored values (never the raw client body).
      if (url.pathname === '/api/products' && req.method === 'POST') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const name = sanitizeText(b.name, 200);
        const sku = validSku(b.sku);
        const category = sanitizeText(b.category, 100);
        const description = sanitizeText(b.description, 5000);
        const price = validNum(b.price, 0, 10000000);
        if (!name || !sku || !category) {
          return json({ message: 'Product name, SKU and category are required' }, 400);
        }
        if (price === null) {
          return json({ message: 'A valid price is required' }, 400);
        }
        const salePrice = b.salePrice === undefined || b.salePrice === null || b.salePrice === ''
          ? price : validNum(b.salePrice, 0, 10000000);
        if (salePrice === null) {
          return json({ message: 'A valid sale price is required' }, 400);
        }
        const stock = b.stock === undefined || b.stock === null || b.stock === ''
          ? 0 : validInt(b.stock, 0, 100000);
        if (stock === null) return json({ message: 'A valid stock quantity is required' }, 400);
        if (!Array.isArray(b.images) && b.images !== undefined && b.images !== null) {
          return json({ message: 'Images must be a list' }, 400);
        }
        const images = (Array.isArray(b.images) ? b.images : []).slice(0, 20)
          .map(x => sanitizeImageUrl(x)).filter(Boolean);
        if (!Array.isArray(b.sizes) && b.sizes !== undefined && b.sizes !== null) {
          return json({ message: 'Sizes must be a list' }, 400);
        }
        const sizes = (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 50)
          .map(x => sanitizeText(x, 50)).filter(Boolean);
        const imageUrl = sanitizeImageUrl(b.imageUrl) || (images[0] || '');
        const cardImage = sanitizeImageUrl(b.cardImage);
        if (b.cardImage && !imageDataPattern.test(cardImage)) return json({ message: 'Invalid card image' }, 400);
        if (JSON.stringify(images).length > 1_500_000) return json({ message: 'Product images are too large' }, 413);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO products (id,name,sku,category,price,sale_price,stock,description,image_url,images,featured,created_at,sizes,card_image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(
          id, name, sku, category,
          price, salePrice,
          stock, description,
          imageUrl, JSON.stringify(images),
          b.featured ? 1 : 0, Date.now(), JSON.stringify(sizes), cardImage
        ).run();
        return json({ id, _id: id, name, sku, category, price, salePrice, stock, description, imageUrl, images, sizes }, 201);
      }

      // Create category
      if (url.pathname === '/api/categories' && req.method === 'POST') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const name = sanitizeText(b.name, 100);
        if (!name) return json({ message: 'Category name required' }, 400);

        try {
          const id = crypto.randomUUID();
          await env.DB.prepare(
            'INSERT INTO categories (id,name,created_at) VALUES (?,?,?)'
          ).bind(id, name, Date.now()).run();
          return json({ id, name }, 201);
        } catch (e) {
          return json({ message: 'Category already exists' }, 409);
        }
      }

      // Rename category
      const cb = url.pathname.match(/^\/api\/categories\/by-name\/(.+)$/);
      if (cb && req.method === 'PATCH') {
        const b = await body(req);
        const old = decodeURIComponent(cb[1]);
        const name = String(b.name || '').trim();
        if (!name) return json({ message: 'Category name required' }, 400);

        if (old === name) return json({ name });
        try {
          const [updated, created] = await env.DB.batch([
            env.DB.prepare('UPDATE categories SET name=? WHERE name=?').bind(name,old),
            env.DB.prepare('INSERT INTO categories (id,name,created_at) SELECT ?,?,? WHERE changes()=0 AND EXISTS (SELECT 1 FROM products WHERE category=?)')
              .bind(crypto.randomUUID(),name,Date.now(),old),
            env.DB.prepare('UPDATE products SET category=? WHERE category=?').bind(name,old),
            ...['categoryImage:', 'categoryDescription:'].map(prefix =>
              env.DB.prepare('UPDATE OR REPLACE builder_settings SET key=? WHERE key=?').bind(prefix + name,prefix + old)
            )
          ]);
          if (!updated.meta.changes && !created.meta.changes) return json({ message: 'Category not found' }, 404);
          return json({ name });
        } catch (e) {
          if (String(e.message).includes('UNIQUE constraint failed: categories.name')) return json({ message: 'Category already exists' }, 409);
          throw e;
        }
      }

      // SAFE-FIX (2026-11-25): the old handler overwrote EVERY column on
      // every PATCH, coercing missing price/salePrice to 0 (and missing
      // name/category/description to ''). The admin table's quick-save sends
      // only {name, category, salePrice, stock} — no price — so one quick
      // save silently zeroed the product's price in the live DB. Now only
      // fields actually present in the request body are updated; anything
      // absent is left exactly as it is in the DB.
      const pm = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (pm && req.method === 'PATCH') {
        const b = asObject(await body(req));
        if (!b) return json({ message: 'Invalid request body' }, 400);
        const key = decodeURIComponent(pm[1]);
        if (!key || key.length > 200) return json({ message: 'Product not found' }, 404);
        const sets = [];
        const values = [];
        const has = k => Object.prototype.hasOwnProperty.call(b, k);
        // SECURITY (2026-11-25): same validation as product create, applied
        // per-field — text is HTML-stripped and capped, numbers are bounded,
        // image URLs are scheme-checked, sizes are capped at 50 entries.
        const numField = (k, label, max) => {
          const n = validNum(b[k], 0, max);
          if (n === null) throw new Error(`Invalid ${label}`);
          return n;
        };
        const intField = (k, label, max) => {
          const n = validInt(b[k], 0, max);
          if (n === null) throw new Error(`Invalid ${label}`);
          return n;
        };
        try {
          if (has('name')) {
            const v = sanitizeText(b.name, 200);
            if (!v) throw new Error('Invalid name');
            sets.push('name=?'); values.push(v);
          }
          if (has('sku')) {
            const v = validSku(b.sku);
            if (!v) throw new Error('Invalid sku');
            sets.push('sku=?'); values.push(v);
          }
          if (has('category')) {
            const v = sanitizeText(b.category, 100);
            if (!v) throw new Error('Invalid category');
            sets.push('category=?'); values.push(v);
          }
          if (has('price')) { sets.push('price=?'); values.push(numField('price', 'price', 10000000)); }
          if (has('salePrice')) { sets.push('sale_price=?'); values.push(numField('salePrice', 'sale price', 10000000)); }
          if (has('stock')) { sets.push('stock=?'); values.push(intField('stock', 'stock', 100000)); }
          if (has('description')) { sets.push('description=?'); values.push(sanitizeText(b.description, 5000)); }
          if (has('featured')) { sets.push('featured=?'); values.push(b.featured ? 1 : 0); }
          if (has('cardImage')) {
            const card = typeof b.cardImage === 'string' ? b.cardImage : '';
            if (card && !imageDataPattern.test(card)) throw new Error('Invalid card image');
            sets.push('card_image_url=?'); values.push(card);
          }
          if (Array.isArray(b.images)) {
            const images = b.images.slice(0, 20).map(x => sanitizeImageUrl(x)).filter(Boolean);
            sets.push('images=?'); values.push(JSON.stringify(images));
            sets.push('image_url=?'); values.push(images[0] || sanitizeImageUrl(b.imageUrl));
          } else if (has('imageUrl')) { sets.push('image_url=?'); values.push(sanitizeImageUrl(b.imageUrl)); }
          if (Array.isArray(b.sizes)) {
            const sizes = b.sizes.slice(0, 50).map(x => sanitizeText(x, 50)).filter(Boolean);
            sets.push('sizes=?'); values.push(JSON.stringify(sizes));
          }
        } catch (e) {
          return json({ message: String(e.message || e) }, 400);
        }
        if (!sets.length) return json({ message: 'No updatable fields provided' }, 400);
        if (values.some(value => typeof value === 'string' && value.length > 1_500_000)) {
          return json({ message: 'Product data is too large. Resize the images and try again.' }, 413);
        }
        values.push(key, key);
        const result = await env.DB.prepare(
          `UPDATE products SET ${sets.join(', ')} WHERE id=${productIdLookup}`
        ).bind(...values).run();
        if (!result.meta.changes) return json({ message: 'Product not found' }, 404);
        return json({ ok: true });
      }

      // Delete product
      if (pm && req.method === 'DELETE') {
        const key = decodeURIComponent(pm[1]);
        const result = await env.DB.prepare(
          `DELETE FROM products WHERE id=${productIdLookup}`
        ).bind(key, key).run();
        if (!result.meta.changes) return json({ message: 'Product not found' }, 404);
        return json({ ok: true });
      }

      // Toggle product hidden status
      const phid = url.pathname.match(/^\/api\/products\/([^/]+)\/hidden$/);
      if (phid && req.method === 'PATCH') {
        const b = await body(req);
        const productId = decodeURIComponent(phid[1]);
        if (typeof b.hidden !== 'boolean') return json({ message: 'Hidden must be true or false' }, 400);
        const hidden = b.hidden ? 1 : 0;

        try {
          const result = await env.DB.prepare(
            `UPDATE products SET hidden=? WHERE id=${productIdLookup}`
          ).bind(hidden, productId, productId).run();
          if (!result.meta.changes) return json({ message: 'Product not found' }, 404);
          return json({ ok: true });
        } catch (e) {
          return json({ message: 'Failed to update product: ' + e.message }, 500);
        }
      }

      // List orders (admin only)
      // Coupons (admin only).  The table is present in the production D1
      // database; keep the CRUD endpoint here so the admin screen does not
      // fail with a 404 and coupon records can be managed safely.
      if (url.pathname === '/api/coupons' && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT id,code,type,value,min_order AS minOrder,expires_at AS expiresAt,active,created_at AS createdAt FROM coupons ORDER BY created_at DESC').all();
        return json(r.results);
      }
      if (url.pathname === '/api/coupons' && req.method === 'POST') {
        const b = asObject(await body(req));
        const code = sanitizeText(b?.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        const type = b?.type === 'flat' ? 'flat' : 'percent';
        const value = Number(b?.value);
        const minOrder = Number(b?.minOrder || 0);
        const expiresAt = b?.expiresAt ? Number(b.expiresAt) : null;
        if (!code || !Number.isFinite(value) || value <= 0 || !Number.isFinite(minOrder) || minOrder < 0) return json({message:'Invalid coupon details'},400);
        if (type === 'percent' && value > 100) return json({message:'Percent cannot exceed 100'},400);
        try {
          const id = crypto.randomUUID();
          await env.DB.prepare('INSERT INTO coupons (id,code,type,value,min_order,expires_at,active,created_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,code,type,value,minOrder,expiresAt,b?.active === false ? 0 : 1,Date.now()).run();
          return json({id,code,type,value,minOrder,expiresAt,active:b?.active === false ? 0 : 1},201);
        } catch (e) { return json({message:e.message.includes('UNIQUE')?'Coupon code already exists':'Failed to save coupon'},409); }
      }
      const couponDelete = url.pathname.match(/^\/api\/coupons\/([^/]+)$/);
      if (couponDelete && req.method === 'DELETE') {
        const result = await env.DB.prepare('DELETE FROM coupons WHERE id=?').bind(decodeURIComponent(couponDelete[1])).run();
        if (!result.meta.changes) return json({message:'Coupon not found'},404);
        return json({ok:true});
      }

      if (url.pathname === '/api/orders' && req.method === 'GET') {
        const r = await env.DB.prepare(
          'SELECT * FROM orders ORDER BY created_at DESC LIMIT 200'
        ).all();
        return json(r.results);
      }

      // Update order status (admin only)
      const om = url.pathname.match(/^\/api\/orders\/([^/]+)\/status$/);
      if (om && req.method === 'PATCH') {
        const b = await body(req);
        const status = String(b.status || '').trim();
        const orderId = decodeURIComponent(om[1]);

        if (!VALID_ORDER_STATUSES.includes(status)) {
          return json({ message: 'Invalid order status' }, 400);
        }

        const order = await env.DB.prepare('SELECT status,items FROM orders WHERE id=?').bind(orderId).first();
        if (!order) return json({ message: 'Order not found' }, 404);
        if (order.status === status) return json({ ok: true });
        const cancelling = status === 'cancelled';
        const reopening = order.status === 'cancelled';
        const statements = [];
        if (cancelling || reopening) {
          const inventory = new Map();
          const items = JSON.parse(order.items || '[]');
          for (const item of items) {
            const key = item.productId || item.sku;
            const quantity = Number(item.quantity);
            if (!key || !Number.isSafeInteger(quantity) || quantity < 1) {
              return json({ message: 'Order inventory must be corrected before changing this status' }, 409);
            }
            inventory.set(key, (inventory.get(key) || 0) + quantity);
          }
          const requested = JSON.stringify(Array.from(inventory, ([key, quantity]) => ({ key, quantity })));
          if (reopening) {
            statements.push(env.DB.prepare(`
              UPDATE orders SET status=? WHERE id=? AND status=? AND NOT EXISTS (
                SELECT 1 FROM json_each(?) item
                LEFT JOIN products p ON p.id=COALESCE(
                  (SELECT id FROM products WHERE id=json_extract(item.value,'$.key')),
                  (SELECT id FROM products WHERE sku=json_extract(item.value,'$.key'))
                ) WHERE p.id IS NULL OR p.stock IS NULL OR p.stock<json_extract(item.value,'$.quantity')
              )
            `).bind(status,orderId,order.status,requested));
          } else {
            statements.push(env.DB.prepare('UPDATE orders SET status=? WHERE id=? AND status=?').bind(status,orderId,order.status));
          }
          statements.push(env.DB.prepare(`
            UPDATE products SET stock=stock + ? * json_extract(item.value,'$.quantity')
            FROM json_each(?) item WHERE changes()>0 AND products.id=COALESCE(
              (SELECT id FROM products WHERE id=json_extract(item.value,'$.key')),
              (SELECT id FROM products WHERE sku=json_extract(item.value,'$.key'))
            )
          `).bind(cancelling ? 1 : -1,requested));
        } else {
          statements.push(env.DB.prepare('UPDATE orders SET status=? WHERE id=? AND status=?').bind(status,orderId,order.status));
        }
        const [result] = await env.DB.batch(statements);
        if (!result.meta.changes) return json({ message: 'Order status or available stock changed. Refresh and try again.' }, 409);
        return json({ ok: true });
      }

      // Admin stats
      if (url.pathname === '/api/admin/stats' && req.method === 'GET') {
        const p = await env.DB.prepare('SELECT COUNT(*) count FROM products').first();
        const o = await env.DB.prepare(
          'SELECT COUNT(*) count, COALESCE(SUM(total),0) sales FROM orders WHERE status!=?'
        ).bind('cancelled').first();
        return json({ products: p.count, orders: o.count, sales: o.sales, customers: 0 });
      }

      return json({ message: 'API route not found' }, 404);
    } catch (e) {
      console.error('API Error:', e);
      try {
        return json({ ok: false, error: String(e.message || e) }, 500);
      } catch {
        return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS } });
      }
    }
  }
};
