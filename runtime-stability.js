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

  /* Prevent repeated mobile search result containers from stacking. */
  const cleanSearchResults = () => {
    const nodes = [...document.querySelectorAll('.mobile-search-results')];
    nodes.slice(1).forEach(node => node.remove());
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cleanSearchResults, { once: true });
  else cleanSearchResults();

  /* Keep dynamically injected product/category images efficient and stable. */
  const prepareImages = root => root.querySelectorAll?.('img').forEach(img => {
    if (!img.loading) img.loading = 'lazy';
    if (!img.decoding) img.decoding = 'async';
  });
  prepareImages(document);
  new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType === 1) prepareImages(node);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  const format = value => typeof window.money === 'function' ? window.money(value) : 'Rs. ' + Number(value || 0).toLocaleString('en-PK');
  window.updateCart = function () {
    const items = Array.isArray(window.cart) ? window.cart : [];
    const count = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
    const total = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0);
    const text = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
    text('cartCount', count); text('cartTotalItems', '(' + count + ')'); text('cartTotal', format(total));
    const box = document.getElementById('cartItems');
    if (!box) return;
    box.innerHTML = items.length ? items.map(item => {
      const id = JSON.stringify(item.id), image = item.imageUrl || (item.sku ? '/assets/products/' + item.sku + '.webp' : '');
      return '<div class="cart-line"><div class="thumb">' + (image ? '<img src="' + image + '" alt="Product" loading="lazy" decoding="async">' : (item.art || '')) + '</div><div><h4>' + (item.name || 'Product') + '</h4><p>' + format(item.price) + ' - Qty ' + Number(item.qty || 0) + '</p><div class="cart-controls"><button type="button" onclick="changeCartQty(' + id + ',-1)" aria-label="Decrease quantity">−</button><span class="qty">' + Number(item.qty || 0) + '</span><button type="button" onclick="changeCartQty(' + id + ',1)" aria-label="Increase quantity">+</button><button type="button" class="cart-trash" aria-label="Remove item" onclick="removeFromCart(' + id + ')">×</button></div></div></div>';
    }).join('') : '<div class="empty-cart">Your bag is waiting for something lovely</div>';
  };
  document.addEventListener('DOMContentLoaded', () => window.updateCart(), { once: true });
})();
