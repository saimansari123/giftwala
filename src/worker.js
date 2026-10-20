const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json;charset=UTF-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization'
  }
});

const body = async req => {
  try { return await req.json(); }
  catch { return {}; }
};

const token = req => String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

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
    images,
    sizes,
    createdAt: p.created_at
  };
};

const VALID_ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
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
        if (String(b.email) !== String(env.ADMIN_EMAIL) ||
            String(b.password) !== String(env.ADMIN_PASSWORD)) {
          return json({ message: 'Invalid credentials' }, 401);
        }
        return json({ token: env.ADMIN_TOKEN, email: env.ADMIN_EMAIL });
      }

      // Get single product
      const singleProduct = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (singleProduct && req.method === 'GET') {
        const key = decodeURIComponent(singleProduct[1]);
        const p = await env.DB.prepare(
          'SELECT * FROM products WHERE id=? OR sku=? LIMIT 1'
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
          const query = q
            ? 'SELECT * FROM products WHERE category=? ORDER BY featured DESC, created_at DESC'
            : 'SELECT * FROM products ORDER BY featured DESC, created_at DESC';
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
          `SELECT id,name,sku,category,price,sale_price,stock,description,image_url,featured,created_at,sizes
           FROM products ${q ? 'WHERE category=?' : ''}
           ORDER BY featured DESC, created_at DESC`
        ).bind(...(q ? [q] : [])).all();
        return json(r.results.map(productOut));
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

        // Validate items against products in DB
        let total = 0;
        for (const item of b.items) {
          if (!item.sku || !item.quantity || item.quantity <= 0) {
            return json({ message: 'Invalid item quantity' }, 400);
          }

          const product = await env.DB.prepare(
            'SELECT price, sale_price, stock FROM products WHERE id=? OR sku=?'
          ).bind(item.sku, item.sku).first();

          if (!product) {
            return json({ message: `Product ${item.sku} not found` }, 404);
          }

          if (product.stock < item.quantity) {
            return json({ message: `Insufficient stock for ${item.sku}` }, 400);
          }

          // Use DB price, not client price
          const price = product.sale_price || product.price;
          total += price * item.quantity;
        }

        // Reduce stock for all items
        for (const item of b.items) {
          await env.DB.prepare(
            'UPDATE products SET stock = stock - ? WHERE id=? OR sku=?'
          ).bind(item.quantity, item.sku, item.sku).run();
        }

        // Ensure order_sequence table exists and initialize
        try {
          await env.DB.prepare(
            'CREATE TABLE IF NOT EXISTS order_sequence (key TEXT PRIMARY KEY, next_number INTEGER DEFAULT 1)'
          ).run();
          await env.DB.prepare(
            'INSERT OR IGNORE INTO order_sequence (key, next_number) VALUES (?, ?)'
          ).bind('order_id', 1).run();
        } catch (e) {
          console.error('Sequence init error:', e);
        }

        // Generate sequential order ID using sequence table
        const seq = await env.DB.prepare(
          'SELECT next_number FROM order_sequence WHERE key=?'
        ).bind('order_id').first();

        const nextNum = seq?.next_number || 1;
        const id = 'GW-' + String(nextNum).padStart(5, '0');

        // Increment sequence for next order
        await env.DB.prepare(
          'UPDATE order_sequence SET next_number = next_number + 1 WHERE key=?'
        ).bind('order_id').run();

        await env.DB.prepare(
          'INSERT INTO orders (id,customer_name,phone,email,address,payment_method,items,total,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
        ).bind(
          id,
          b.customer.name,
          b.customer.phone,
          b.customer.email || '',
          b.customer.address,
          b.paymentMethod || 'Cash on Delivery',
          JSON.stringify(b.items),
          total,
          'pending',
          Date.now()
        ).run();

        return json({ _id: id, total, status: 'pending' }, 201);
      }

      // Get order by ID
      const orderById = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (orderById && req.method === 'GET') {
        const orderId = decodeURIComponent(orderById[1]);
        const order = await env.DB.prepare(
          'SELECT * FROM orders WHERE id=?'
        ).bind(orderId).first();
        return order ? json(order) : json({ message: 'Order not found' }, 404);
      }

      // Admin routes
      const guard = await admin(req, env);
      if (guard) return guard;

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
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(data)) {
          return json({ message: 'Send a PNG, JPG or WEBP image' }, 400);
        }
        if (data.length > 7 * 1024 * 1024) {
          return json({ message: 'Image must be 7MB or smaller' }, 413);
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

      // Get media by SKU
      if (url.pathname.startsWith('/api/media/') && req.method === 'GET') {
        const sku = url.pathname.replace('/api/media/', '').trim();
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
        const imgId = url.pathname.replace('/api/media/', '').trim();
        if (!imgId) return json({ message: 'Image ID required' }, 400);

        try {
          await env.DB.prepare('DELETE FROM media WHERE id = ?').bind(imgId).run();
          return json({ ok: true });
        } catch (e) {
          return json({ message: 'Failed to delete media: ' + e.message }, 500);
        }
      }

      // Update builder settings
      if (url.pathname === '/api/admin/builder-settings' && req.method === 'PATCH') {
        const b = await body(req);
        for (const [key, value] of Object.entries(b)) {
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind(key, String(value ?? '')).run();
        }
        return json({ ok: true });
      }

      // Update category settings
      if (url.pathname === '/api/admin/category-settings' && req.method === 'PATCH') {
        const b = await body(req);
        const name = String(b.name || '').trim();
        if (!name) return json({ message: 'Category name required' }, 400);

        if (Object.prototype.hasOwnProperty.call(b, 'image')) {
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind('categoryImage:' + name, String(b.image || '')).run();
        }

        if (Object.prototype.hasOwnProperty.call(b, 'description')) {
          await env.DB.prepare(
            'INSERT INTO builder_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
          ).bind('categoryDescription:' + name, String(b.description || '')).run();
        }

        return json({ ok: true });
      }

      // Create product
      if (url.pathname === '/api/products' && req.method === 'POST') {
        const b = await body(req);
        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO products (id,name,sku,category,price,sale_price,stock,description,image_url,images,featured,created_at,sizes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(
          id, b.name, b.sku, b.category,
          Number(b.price || 0), Number(b.salePrice || b.price || 0),
          Number(b.stock || 0), b.description || '',
          b.imageUrl || '', JSON.stringify(b.images || []),
          0, Date.now(), JSON.stringify(Array.isArray(b.sizes) ? b.sizes : [])
        ).run();
        return json({ ...b, _id: id }, 201);
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

        try {
          const result = await env.DB.prepare(
            'UPDATE categories SET name=? WHERE name=?'
          ).bind(name, old).run();
          if (!result.meta?.changes) return json({ message: 'Category not found' }, 404);

          await env.DB.prepare(
            'UPDATE products SET category=? WHERE category=?'
          ).bind(name, old).run();
          return json({ name });
        } catch (e) {
          return json({ message: 'Category already exists' }, 409);
        }
      }

      // Update product
      const pm = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (pm && req.method === 'PATCH') {
        const b = await body(req);
        const key = pm[1];
        const hasImages = Array.isArray(b.images);
        const sql = hasImages
          ? 'UPDATE products SET name=?,sku=?,category=?,price=?,sale_price=?,stock=?,description=?,featured=?,images=?,image_url=?,sizes=? WHERE id=? OR sku=?'
          : 'UPDATE products SET name=?,sku=?,category=?,price=?,sale_price=?,stock=?,description=?,featured=?,sizes=? WHERE id=? OR sku=?';
        const values = [
          String(b.name ?? ''), String(b.sku ?? key), String(b.category ?? ''),
          Number(b.price ?? 0), Number(b.salePrice ?? b.price ?? 0),
          Number(b.stock ?? 0), String(b.description ?? ''),
          b.featured ? 1 : 0
        ];
        if (hasImages) values.push(JSON.stringify(b.images), b.images[0] ? String(b.images[0]) : String(b.imageUrl ?? ''));
        values.push(JSON.stringify(Array.isArray(b.sizes) ? b.sizes : []), key, key);
        await env.DB.prepare(sql).bind(...values).run();
        return json({ ok: true });
      }

      // Delete product
      const pdel = url.pathname.match(/^\/api\/products\/([^/]+)$/);
      if (pdel && req.method === 'DELETE') {
        const productId = pdel[1];
        const product = await env.DB.prepare(
          'SELECT stock, items FROM products WHERE id=? OR sku=?'
        ).bind(productId, productId).first();

        if (!product) return json({ message: 'Product not found' }, 404);

        try {
          await env.DB.prepare(
            'DELETE FROM products WHERE id=? OR sku=?'
          ).bind(productId, productId).run();
          return json({ ok: true });
        } catch (e) {
          return json({ message: 'Failed to delete product: ' + e.message }, 500);
        }
      }

      // Toggle product hidden status
      const phid = url.pathname.match(/^\/api\/products\/([^/]+)\/hidden$/);
      if (phid && req.method === 'PATCH') {
        const b = await body(req);
        const productId = phid[1];
        const hidden = b.hidden ? 1 : 0;

        try {
          await env.DB.prepare(
            'UPDATE products SET hidden=? WHERE id=? OR sku=?'
          ).bind(hidden, productId, productId).run();
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
        const orderId = om[1];

        if (!VALID_ORDER_STATUSES.includes(status)) {
          return json({ message: 'Invalid order status' }, 400);
        }

        // If cancelling, restore stock and decrement order sequence
        if (status === 'cancelled') {
          const order = await env.DB.prepare(
            'SELECT items FROM orders WHERE id=?'
          ).bind(orderId).first();

          if (order && order.items) {
            try {
              const items = JSON.parse(order.items || '[]');
              for (const item of items) {
                await env.DB.prepare(
                  'UPDATE products SET stock = stock + ? WHERE sku=?'
                ).bind(item.quantity, item.sku).run();
              }

              // Ensure order_sequence table exists and initialize
              try {
                await env.DB.prepare(
                  'CREATE TABLE IF NOT EXISTS order_sequence (key TEXT PRIMARY KEY, next_number INTEGER DEFAULT 1)'
                ).run();
                await env.DB.prepare(
                  'INSERT OR IGNORE INTO order_sequence (key, next_number) VALUES (?, ?)'
                ).bind('order_id', 1).run();
              } catch (e) {
                console.error('Sequence init error:', e);
              }

              // Decrement order sequence so next order reuses this ID
              const currentSeq = await env.DB.prepare(
                'SELECT next_number FROM order_sequence WHERE key=?'
              ).bind('order_id').first();

              if (currentSeq && currentSeq.next_number > 1) {
                await env.DB.prepare(
                  'UPDATE order_sequence SET next_number = next_number - 1 WHERE key=?'
                ).bind('order_id').run();
              }
            } catch (e) {
              return json({ message: 'Failed to cancel order: ' + e.message }, 500);
            }
          }
        }

        await env.DB.prepare(
          'UPDATE orders SET status=? WHERE id=?'
        ).bind(status, orderId).run();
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
