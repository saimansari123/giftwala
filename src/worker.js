const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json;charset=UTF-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization'
  }
});

const body = async req => {
  try {
    const value = await req.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
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
    imageUrl: p.image_url,
    cardImage: p.card_image_url || '',
    images,
    sizes,
    createdAt: p.created_at
  };
};

const VALID_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const productIdLookup = 'COALESCE((SELECT id FROM products WHERE id=?), (SELECT id FROM products WHERE sku=?))';
const REVIEW_RATE_LIMIT = 5; // reviews per IP per 24h
const reviewStore = new Map(); // in-memory store (reset on worker restart)

async function admin(req, env) {
  const t = token(req);
  if (!t || t !== env.ADMIN_TOKEN) return json({ message: 'Admin login required' }, 401);
  return null;
}

function getClientIP(req) {
  return req.headers.get('cf-connecting-ip') ||
         req.headers.get('x-forwarded-for')?.split(',')[0] ||
         'unknown';
}

function checkReviewRateLimit(ip) {
  const now = Date.now();
  const key = `review_${ip}`;
  if (!reviewStore.has(key)) reviewStore.set(key, []);

  const times = reviewStore.get(key).filter(t => now - t < 86400000); // 24h
  if (times.length >= REVIEW_RATE_LIMIT) return false;

  times.push(now);
  reviewStore.set(key, times);
  return true;
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
          'access-control-allow-headers': 'Content-Type, Authorization'
        }
      });
    }

    // Legacy builder data endpoint used by the homepage.
    if (url.pathname === '/server/sheet-products.json' && req.method === 'GET') {
      const r = await env.DB.prepare(
        'SELECT id,name,sku,category,price,sale_price,stock,description,image_url,featured,created_at,sizes FROM (SELECT id,name,sku,category,price,sale_price,stock,description,image_url,featured,created_at,sizes,ROW_NUMBER() OVER (PARTITION BY category ORDER BY featured DESC, created_at DESC) AS category_rank FROM products WHERE COALESCE(hidden,0)=0) WHERE category_rank=1 ORDER BY featured DESC, created_at DESC'
      ).all();
      return json((r.results || []).map(productOut));
    }

    // Static files
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

    // Database check
    if (!env.DB) return json({ message: 'Database not configured' }, 503);

    try {
      // Health check
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: 'GiftWALA API' });
      }

      // Admin login
      if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        const b = await body(req);
        if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD || !env.ADMIN_TOKEN) {
          return json({ message: 'Admin sign-in is not configured' }, 503);
        }
        if (b.email !== env.ADMIN_EMAIL || b.password !== env.ADMIN_PASSWORD) {
          return json({ message: 'Invalid credentials' }, 401);
        }
        return json({ token: env.ADMIN_TOKEN, email: env.ADMIN_EMAIL });
      }

      // Get single product
      const singleProduct = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (singleProduct && req.method === 'GET') {
        const key = decodeURIComponent(singleProduct[1]);
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

      // List products (public)
      if (url.pathname === '/api/products' && req.method === 'GET') {
        try {
          const q = url.searchParams.get('category');
          const search = url.searchParams.get('search') === '1';
          if (search) {
            const r = await env.DB.prepare(
              'SELECT id,name,sku,category,price,sale_price FROM products WHERE COALESCE(hidden,0)=0 ORDER BY featured DESC, created_at DESC'
            ).all();
            return json((r.results || []).map(p => ({ id:p.id, name:p.name, sku:p.sku, category:p.category, price:p.price, salePrice:p.sale_price })));
          }
          const fields = "id,name,sku,category,price,sale_price,stock,description,CASE WHEN image_url LIKE 'data:image/%' THEN '/api/product-images/' || id ELSE image_url END AS image_url,CASE WHEN card_image_url <> '' THEN '/api/product-images/' || id || '/card' ELSE '' END AS card_image_url,featured,created_at,sizes";
          const query = q
            ? `SELECT ${fields} FROM products WHERE category=? AND COALESCE(hidden,0)=0 ORDER BY featured DESC, created_at DESC`
          : `SELECT * FROM (SELECT ${fields}, ROW_NUMBER() OVER (PARTITION BY category ORDER BY featured DESC, created_at DESC) AS category_rank FROM products WHERE COALESCE(hidden,0)=0) WHERE category_rank <= 4 ORDER BY featured DESC, created_at DESC`;
          const r = await env.DB.prepare(query).bind(...(q ? [q] : [])).all();
          const results = r.results || [];
          return json(results.map(productOut));
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
           ORDER BY featured DESC, created_at DESC`
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
          'SELECT name FROM categories UNION SELECT DISTINCT category AS name FROM products WHERE COALESCE(hidden,0)=0 ORDER BY name'
        ).all();
        return json(r.results.map(x => x.name));
      }

      // Get builder settings
      if (url.pathname === '/api/builder-settings' && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT key,value FROM builder_settings').all();
        return json(Object.fromEntries(r.results.map(x => [x.key, x.value])));
      }

      // List reviews
      if (url.pathname === '/api/reviews' && req.method === 'GET') {
        const r = await env.DB.prepare(
          'SELECT id,name,comment,rating,created_at AS createdAt,product_id AS productId,product_name AS productName FROM reviews ORDER BY created_at DESC'
        ).all();
        return json(r.results);
      }

      // Create review (with rate limiting)
      if (url.pathname === '/api/reviews' && req.method === 'POST') {
        const ip = getClientIP(req);
        if (!checkReviewRateLimit(ip)) {
          return json({ message: 'Too many reviews. Try again later.' }, 429);
        }

        const b = await body(req);
        const name = String(b.name || '').trim();
        const comment = String(b.comment || '').trim();
        const rating = Math.max(1, Math.min(5, Number(b.rating || 0)));
        const productId = String(b.productId || '').trim();
        const productName = String(b.productName || '').trim();

        if (!name || !comment || !rating) {
          return json({ message: 'Name, review and rating are required' }, 400);
        }

        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO reviews (id,name,comment,rating,created_at,product_id,product_name) VALUES (?,?,?,?,?,?,?)'
        ).bind(id, name, comment, rating, Date.now(), productId || null, productName || null).run();

        return json({ id, name, comment, rating, productId, productName }, 201);
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

      // Create order (WITH PRODUCT VALIDATION)
      if (url.pathname === '/api/orders' && req.method === 'POST') {
        const b = await body(req);
        if (!b.customer?.name || !b.customer?.phone || !b.customer?.address || !b.items?.length) {
          return json({ message: 'Customer and order details required' }, 400);
        }

        if (!Array.isArray(b.items) || b.items.some(item =>
          !item || typeof item.sku !== 'string' || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) < 1
        )) return json({ message: 'Invalid order items' }, 400);

        const items = [], quantities = new Map();
        let total = 0;
        for (const item of b.items) {
          const product = await env.DB.prepare(
            `SELECT id, sku, name, price, sale_price, stock FROM products WHERE id=${productIdLookup} AND COALESCE(hidden,0)=0`
          ).bind(item.sku, item.sku).first();
          if (!product) return json({ message: 'Product unavailable' }, 404);
          const quantity = Number(item.quantity);
          const reserved = (quantities.get(product.id) || 0) + quantity;
          if (reserved > product.stock) return json({ message: 'Insufficient stock for ' + product.sku }, 409);
          quantities.set(product.id, reserved);
          const price = product.sale_price || product.price;
          total += price * quantity;
          items.push({ ...item, productId: product.id, sku: product.sku, name: product.name, quantity, price });
        }

        const inventory = JSON.stringify(Array.from(quantities, ([id, quantity]) => ({ id, quantity })));
        const saved = await env.DB.batch([
          env.DB.prepare("INSERT OR IGNORE INTO order_sequence (key,next_number) VALUES ('order_id',1)"),
          env.DB.prepare(`
            INSERT INTO orders (id,customer_name,phone,email,address,payment_method,items,total,status,created_at)
            SELECT printf('GW-%05d', MAX(next_number,
              COALESCE((SELECT MAX(CAST(substr(id,4) AS INTEGER)) + 1 FROM orders WHERE id GLOB 'GW-[0-9]*'),1)
            )), ?,?,?,?,?,?,?, 'pending', ?
            FROM order_sequence WHERE key='order_id'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(?) requested LEFT JOIN products p ON p.id=json_extract(requested.value,'$.id')
              WHERE p.id IS NULL OR COALESCE(p.hidden,0)<>0 OR p.stock IS NULL OR p.stock<json_extract(requested.value,'$.quantity')
            )
            RETURNING id
          `).bind(b.customer.name,b.customer.phone,b.customer.email || '',b.customer.address,
            b.paymentMethod || 'Cash on Delivery',JSON.stringify(items),total,Date.now(),inventory),
          env.DB.prepare(`
            UPDATE products SET stock=stock-json_extract(requested.value,'$.quantity')
            FROM json_each(?) requested WHERE changes()>0 AND products.id=json_extract(requested.value,'$.id')
          `).bind(inventory),
          env.DB.prepare("UPDATE order_sequence SET next_number=(SELECT MAX(CAST(substr(id,4) AS INTEGER))+1 FROM orders WHERE id GLOB 'GW-[0-9]*') WHERE key='order_id' AND changes()>0")
        ]);
        const id = saved[1].results[0]?.id;
        if (!id) return json({ message: 'Stock changed. Please review the cart and try again.' }, 409);
        return json({ _id: id, total, status: 'pending' }, 201);
      }

      // Get order by ID
      const orderById = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderById && req.method === 'GET') {
        const orderId = decodeURIComponent(orderById[1]);
        const order = await env.DB.prepare(
          'SELECT id AS _id, id, status, total FROM orders WHERE id=?'
        ).bind(orderId).first();
        return order ? json(order) : json({ message: 'Order not found' }, 404);
      }

      // Admin routes
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
        await env.DB.prepare('DELETE FROM reviews WHERE id=?').bind(rm[1]).run();
        return json({ ok: true });
      }

      // Upload image (base64 - TODO: migrate to R2)
      if (url.pathname === '/api/uploads/image' && req.method === 'POST') {
        const b = await body(req);
        const data = String(b.data || '');
        const filename = String(b.filename || 'image');
        const sku = String(b.sku || '').trim();

        if (!sku) return json({ message: 'SKU required' }, 400);
        if (!imageDataPattern.test(data)) {
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
        if (!sku) return json({ message: 'SKU required' }, 400);

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
        if (!imgId) return json({ message: 'Image ID required' }, 400);

        try {
          const result = await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(imgId).run();
          if (!result.meta.changes) return json({ message: 'Image not found' }, 404);
          return json({ ok: true });
        } catch (e) {
          return json({ message: 'Failed to delete media: ' + e.message }, 500);
        }
      }

      // Update builder settings
      if (url.pathname === '/api/admin/builder-settings' && req.method === 'PATCH') {
        const b = await body(req);
        const statements = Object.entries(b).map(([key, value]) =>
          env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(key, String(value ?? ''))
        );
        if (statements.length) await env.DB.batch(statements);
        return json({ ok: true });
      }

      // Update category settings
      if (url.pathname === '/api/admin/category-settings' && req.method === 'PATCH') {
        const b = await body(req);
        const name = String(b.name || '').trim();
        if (!name) return json({ message: 'Category name required' }, 400);

        const statements = [['image','categoryImage:'],['description','categoryDescription:']]
          .filter(([field]) => Object.hasOwn(b, field))
          .map(([field,prefix]) => env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(prefix + name, String(b[field] ?? '')));
        if (statements.length) await env.DB.batch(statements);

        return json({ ok: true });
      }

      // Create category
      if (url.pathname === '/api/categories' && req.method === 'POST') {
        const b = await body(req);
        const name = String(b.name || '').trim();
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

      const pm = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      const creatingProduct = url.pathname === '/api/products' && req.method === 'POST';
      if (creatingProduct || (pm && req.method === 'PATCH')) {
        const b = await body(req);
        const key = creatingProduct ? '' : decodeURIComponent(pm[1]);
        const existing = creatingProduct ? null : await env.DB.prepare(
          `SELECT id,name,sku,category,price,sale_price,stock,description,featured,sizes FROM products WHERE id=${productIdLookup}`
        ).bind(key,key).first();
        if (!creatingProduct && !existing) return json({ message: 'Product not found' }, 404);
        const name = String(b.name ?? existing?.name ?? '').trim();
        const sku = String(b.sku ?? existing?.sku ?? '').trim();
        const category = String(b.category ?? existing?.category ?? '').trim();
        const price = Number(b.price ?? existing?.price ?? 0);
        const salePrice = Number(b.salePrice ?? existing?.sale_price ?? price);
        const stock = Number(b.stock ?? existing?.stock ?? 0);
        if (!name || !sku || !category) return json({ message: 'Name, SKU and category are required' }, 400);
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(salePrice) || salePrice < 0 || salePrice > price ||
            !Number.isSafeInteger(stock) || stock < 0) {
          return json({ message: 'Check the price, sale price and stock' }, 400);
        }

        const fields = {
          name, sku, category, price, sale_price:salePrice, stock,
          description:String(b.description ?? existing?.description ?? ''),
          featured:Number(Boolean(b.featured ?? existing?.featured)),
          sizes:Array.isArray(b.sizes) ? JSON.stringify(b.sizes) : (existing?.sizes || '[]')
        };
        if (Array.isArray(b.images) || creatingProduct) {
          fields.images = JSON.stringify(Array.isArray(b.images) ? b.images : []);
          fields.image_url = String(b.images?.[0] || b.imageUrl || '');
        }
        if (typeof b.cardImage === 'string') {
          if (b.cardImage && !imageDataPattern.test(b.cardImage)) return json({ message: 'Invalid card image' }, 400);
          fields.card_image_url = b.cardImage;
        }
        if (Object.values(fields).some(value => typeof value === 'string' && value.length > 1_500_000)) {
          return json({ message: 'Product data is too large. Resize the images and try again.' }, 413);
        }

        const id = existing?.id || crypto.randomUUID();
        try {
          if (creatingProduct) {
            const record = { ...fields, id, created_at:Date.now() };
            const columns = Object.keys(record);
            await env.DB.prepare(`INSERT INTO products (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
              .bind(...Object.values(record)).run();
          } else {
            const assignments = Object.keys(fields).map(column => column + '=?');
            const result = await env.DB.prepare(`UPDATE products SET ${assignments.join(',')} WHERE id=?`)
              .bind(...Object.values(fields), id).run();
            if (!result.meta.changes) return json({ message: 'Product not found' }, 404);
          }
        } catch (e) {
          if (String(e.message).includes('UNIQUE constraint failed: products.sku')) return json({ message: 'SKU already exists' }, 409);
          throw e;
        }
        return creatingProduct ? json({ ...b, id, _id:id }, 201) : json({ ok:true });
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
      if (url.pathname === '/api/admin/stats') {
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
        return new Response(JSON.stringify({ ok: false }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
  }
};
