/* Final guarded cart renderer. */
(function () {
  'use strict';
  /* Reuse identical public GET requests made by legacy and current handlers. */
  const nativeFetch = window.fetch.bind(window);
  const requestCache = new Map();
  window.fetch = function (input, init) {
    const method = String(init?.method || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : input?.url || '';
    if (method !== 'GET' || !/^\/api\/(products|categories|reviews)/.test(url)) return nativeFetch(input, init);
    const key = url;
    if (!requestCache.has(key)) requestCache.set(key, nativeFetch(input, init).then(response => response.clone()));
    return requestCache.get(key).then(response => response.clone());
  };


  /* Keep dynamically injected product/category images efficient and stable. */
  const prepareImages = root => root.querySelectorAll?.('img').forEach(img => {
    if (!img.loading) img.loading = 'lazy';
    if (!img.decoding) img.decoding = 'async';
  });
  prepareImages(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) prepareImages(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });

  /* Do not show category sections that have no products. */
  const hideEmptyCatalogSections = () => document.querySelectorAll('.catalog-section').forEach(section => {
    const hasProducts = section.querySelector('.product-card');
    section.hidden = !hasProducts;
  });
  hideEmptyCatalogSections();
  new MutationObserver(hideEmptyCatalogSections).observe(document.body, { childList: true, subtree: true });

  /* Stock labels must come from product data; disable the old hard-coded fallback. */
  window.addStockLabels = function () {};
  document.querySelectorAll('.stock-label').forEach(label => label.remove());
  const format = value => typeof window.money === 'function' ? window.money(value) : 'Rs. ' + Number(value || 0).toLocaleString('en-PK');
  const getCart = () => {
    try {
      if (Array.isArray(window.cart)) return window.cart;
      if (typeof cart !== 'undefined' && Array.isArray(cart)) return cart;
    } catch (_) {}
    return [];
  };
  const calculateCart = items => {
    const safeItems = Array.isArray(items) ? items : [];
    const subtotal = safeItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
    const delivery = safeItems.length ? 300 : 0;
    return { items: safeItems, subtotal, delivery, discount: 0, total: subtotal + delivery };
  };
  window.giftwalaCartTotals = calculateCart;
  const syncCartTotals = () => {
    const totals = calculateCart(getCart());
    const items = totals.items;
    const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    text('cartCount', items.reduce((sum, item) => sum + Number(item.qty || 0), 0));
    text('cartTotalItems', '(' + items.reduce((sum, item) => sum + Number(item.qty || 0), 0) + ')');
    text('cartTotal', format(totals.subtotal));
    text('cartDiscount', format(totals.discount));
    text('cartDelivery', format(totals.delivery));
    text('cartGrandTotal', format(totals.total));
    try {
      const saved = JSON.stringify(items);
      localStorage.setItem('giftwalaCart', saved);
      localStorage.setItem('giftwala_checkout_cart', saved);
    } catch (_) {}
    document.querySelectorAll('#checkoutBtn, #proceedCheckoutBtn, .direct-checkout').forEach(button => {
      button.disabled = !items.length;
      button.setAttribute('aria-disabled', String(!items.length));
    });
  };
  window.updateCart = function () {
    const totals = calculateCart(getCart());
    const items = totals.items;
    const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    text('cartCount', count); text('cartTotalItems', '(' + count + ')'); text('cartTotal', format(totals.subtotal));
    const foot = document.querySelector('.cart-foot');
    if (foot && !document.getElementById('cartDeliveryRow')) {
      const row = document.createElement('div');
      row.id = 'cartDeliveryRow';
      row.innerHTML = '<span>Delivery charges</span><strong id="cartDelivery">Rs. 0</strong>';
      const subtotal = document.getElementById('cartTotal')?.closest('div');
      if (subtotal) subtotal.after(row);
      const grand = document.createElement('div');
      grand.id = 'cartGrandTotalRow';
      grand.innerHTML = '<span>Total</span><strong id="cartGrandTotal">Rs. 0</strong>';
      row.after(grand);
    }
    text('cartDelivery', format(totals.delivery));
    text('cartGrandTotal', format(totals.total));
    document.querySelectorAll('#checkoutBtn, #proceedCheckoutBtn, .direct-checkout').forEach(button => {
      button.disabled = !items.length;
      button.setAttribute('aria-disabled', String(!items.length));
    });
    const box = document.getElementById('cartItems');
    if (!box) return;
    box.innerHTML = items.length ? items.map(item => {
      const id = JSON.stringify(item.id), image = item.imageUrl || (item.sku ? '/assets/products/' + item.sku + '.webp' : '');
      return '<div class="cart-line"><div class="thumb">' + (image ? '<img src="' + image + '" alt="Product" loading="lazy" decoding="async">' : (item.art || '')) + '</div><div><h4>' + (item.name || 'Product') + '</h4><p>' + format(item.price) + ' - Qty ' + Number(item.qty || 0) + '</p><div class="cart-controls"><button type="button" onclick="changeCartQty(' + id + ',-1)" aria-label="Decrease quantity">−</button><span class="qty">' + Number(item.qty || 0) + '</span><button type="button" onclick="changeCartQty(' + id + ',1)" aria-label="Increase quantity">+</button><button type="button" class="cart-trash" aria-label="Remove item" onclick="removeFromCart(' + id + ')">×</button></div></div></div>';
    }).join('') : '<div class="empty-cart">Your bag is waiting for something lovely</div>';
    syncCartTotals();
  };
  const enforceCartTotals = () => {
    const foot = document.querySelector('.cart-foot');
    if (foot && !document.getElementById('cartDeliveryRow')) {
      const row = document.createElement('div');
      row.id = 'cartDeliveryRow';
      row.innerHTML = '<span>Delivery charges</span><strong id="cartDelivery">Rs. 0</strong>';
      const subtotal = document.getElementById('cartTotal')?.closest('div');
      if (subtotal) subtotal.after(row);
      const grand = document.createElement('div');
      grand.id = 'cartGrandTotalRow';
      grand.innerHTML = '<span>Total</span><strong id="cartGrandTotal">Rs. 0</strong>';
      row.after(grand);
    }
    syncCartTotals();
  };
  const startCartSync = () => {
    window.updateCart();
    enforceCartTotals();
    setInterval(() => {
      enforceCartTotals();
    }, 100);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startCartSync, { once: true });
  else startCartSync();
})();
